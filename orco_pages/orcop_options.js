/*
   Copyright (C) 2020-2022 Max Nikulin

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

"use strict";

const { byId, E } = mwel_dom;

var gDescriptors = false;
var gOrcopOptions = gOrcopOptions || {};

function orcopSettingsError(error) {
	try {
		byId("fileReport").append(E(
			"p", { className: "error" },
			String(error)));
	} catch(ex) {
		console.error(ex);
	}
}

function getDescriptionParagraphs(property) {
	let text = property && property.description;
	if (!text) {
		return [];
	}
	if (Array.isArray(text)) {
		text = text.join(" ");
	}
	const paragraphs = text.split("\n");
	return paragraphs.map(p => E("p", null, p));
}

function formatDetails(property) {
	const pars = getDescriptionParagraphs(property);

	const pName = E("p", null, E("code", null, property.name));
	if (!pars || !(pars.length > 0)) {
		return pName;
	}
	return E("details", { open: "true" }, pName, ...pars);
}

function applyValueObject(form, property) {
	const real = form["real." + property.name];
	const realValue = property.value != null ? property.value.value : false;
	switch (getType(property)) {
		case "boolean":
			real.checked = realValue;
			break;
		case "text":
			real.textContent = realValue || "";
			break;
		default:
			real.value = realValue || "";
			break;
	}
	try {
		const def = form[property.name + ".useDefault"];
		const div = byId("container." + property.name);
		if (def.checked) {
			div.classList.add("defaultValue");
			div.classList.remove("userValue");
		} else {
			div.classList.add("userValue");
			div.classList.remove("defaultValue");
		}
	} catch (ex) {
		console.error("applyValueObject %o: %o", property, ex);
	}
}

function formatInput(property, options) {
	const isDefault = options && options.isDefault;
	const inputName = isDefault ? property.name + ".default" : "real." + property.name;
	switch (getType(property)) {
		case "boolean":
			const checkbox = E("input", {
				type: "checkbox",
				name: inputName,
			});
			if (isDefault) {
				// readOnly is not supported for non-text inputs
				checkbox.disabled = true;
				checkbox.checked = !!property.defaultValue;
			}
			return E("label", null, checkbox, "Active");
			break;
		case "text":
			// - limitedWidth to allow user and default fields have independent width.
			// - cols to allow resizing by user behind right screen edge.
			const textarea = E("textarea", {
				name: inputName, className: "limitedWidth", cols: 132
			});
			const content = (isDefault ? property.defaultValue : property.value?.value) ?? "";
			if (isDefault) {
				textarea.readOnly = true;
				textarea.textContent = content;
			}
			textarea.rows = Math.max(
				isDefault? 1 : 3,
				Math.min(10, content.split?.("\n")?.length));
			return isDefault ? E('div', { className: "scroll" }, textarea) : textarea;
			break;
		default:
			const input = E("input", { name: inputName });
			if (isDefault) {
				input.readOnly = true;
				input.value = property.defaultValue != null ? property.defaultValue : "";
			}
			return input;
			break;
	}
}

function formatDefault(property) {
	const isText = getType(property) === "text";
	const divDefault = E("div", isText ? null : { className: "flexLineContainer" });
	divDefault.classList.add("defaultInputContainer");
	divDefault.append(E("input", {
		type: "hidden",
		name: property.name + ".date",
		value: property.value && property.value.date,
	}));
	divDefault.append(E("input", {
		type: "hidden",
		name: property.name + ".version",
		value: property.value && property.value.version,
	}));
	const label = E("label", { className: "defaultLabel" });
	const checkbox = E("input", {
		type: "checkbox", name: property.name + ".useDefault",
	});
	checkbox.checked = !property.value || property.value.useDefault;
	label.append(checkbox);
	label.append("Use default:" + " ");
	divDefault.append(label);
	const input = formatInput(property, { isDefault: true });
	input.classList.add("defaultInput");
	divDefault.append(input);
	return divDefault;
}

function getType(property) {
	if (property.type) {
		return property.type;
	}
	if (typeof property.defaultValue === "boolean")
		return "boolean";
	return "string";
}

function formatPermission(property) {
	console.warn("orcop_options: permissions not supported");
	return E("div", null, "Permissions not supported: " + property.name);
}

function formatPropertyInputs(property) {
	const type = getType(property);
	if (type === "permission") {
		return formatPermission(property);
	}
	const isText = type === "text";
	const input = formatInput(property);
	input.classList.add("userInput");
	const inputContainer = E("div", { className: "userInputContainer", }, input);
	inputContainer.classList.add(isText ? "scroll" : "flexLineContainer");
	const divDefault = formatDefault(property);
	const attrs = { id: "container." + property.name, };
	if (!isText) {
		attrs.className = "flexLineContainer";
	}
	return E("div", attrs, inputContainer, divDefault);
}

async function lrInputChanged(e) {
	try {
		const form = byId("formDescriptors");
		const targetName = e.target.name;
		if (targetName.startsWith("permissions.")) {
			console.warn("throgcp_settings: changed: permissions not supported: " + targetName);
			return;
		}
		const real = targetName.startsWith("real.");
		const name = real ? targetName.substring(5) : targetName.replace(/\.[^.]+$/, "");
		if (real) {
			form[name + ".useDefault"].checked = false;
		}
		const change = makeValueDescriptor(form, name);
		await gOrcopOptions.subscription.postMessage({
			method: "settings.change",
			params: [ { [name]: change, } ],
		});
	} catch (ex) {
		console.error(ex);
		orcopSettingsError(`${e.target.name}: ${ex}`);
	}
}

function renderDescriptors(descriptors) {
	if (gDescriptors) {
		console.error("lrp_options: form already ititialized");
		return;
	}
	const form = byId("formDescriptors");
	gDescriptors = new Map(descriptors.map(p => [p.name, p]));
	for (const property of descriptors) {
		const isText = getType(property) === "text";
		const attrs = isText ? { className: "textParameter" } : null;
		const div = E("div", attrs);
		if ("defaultValue" in property || "type" in property) {
			div.append(E("h3", null, property.title));
			const divInputs = formatPropertyInputs(property)
			if (isText) {
				divInputs.classList.add("scrollContainer");
			}
			div.append(divInputs);
			div.append(formatDetails(property));
			form.append(div);
		} else {
			form.append(E("h2", null, property.title));
			if (property.description) {
				form.append(E("div", null, ...getDescriptionParagraphs(property)));
			}
		}
	}
	for (const property of descriptors) {
		if ("defaultValue" in property && property.type !== 'permission') {
			applyValueObject(form, property);
		}
	}
	form.addEventListener("change", lrInputChanged, false);
}


async function lrOnFileLoad() {
	const fileLoad = byId("fileLoad");
	const divReport = byId("fileReport");
	divReport.innerText = "";
	for (let f of fileLoad.files) {
		try {
			const settings = JSON.parse(await f.text());
			await gOrcopOptions.subscription.postMessage({
				method: "settings.change",
				params: [settings, true ],
			});
			divReport.append(E(
				"p", null,
				`Backup restored from ${f.name}`
			));
		} catch (ex) {
			orcopSettingsError(`${f.name}: ${ex}`);
			throw ex;
		}
	}
}

function makeValueDescriptor(form, name) {
	const input = form["real." + name];
	const value = input.type === "checkbox" ? input.checked : input.value;
	const version = form[name + ".version"].value;
	const date = form[name + ".date"].value;
	const useDefault = form[name + ".useDefault"].checked;
	if (!value && useDefault && !date && !version) {
		return null;
	}
	return { value, version, date, useDefault };
}

function lrGetFormState() {
	const form = byId("formDescriptors");
	const formData = new FormData(form);
	const result = Object.create(null);
	for (const input of form.querySelectorAll("input, textarea")) {
		const namePrefixed = input.name;
		if (!namePrefixed.startsWith("real.")) {
			continue;
		}
		const name = namePrefixed.substring(5);
		const valueDescriptor = makeValueDescriptor(form, name);
		if (valueDescriptor) {
			result[name] = valueDescriptor;
		}
	}
	return result;
}

function orcopOptionsOnMessage(msg) {
	switch (msg.method) {
		case "settings.update":
			console.debug("orcop_options: message", msg);
			for (const [name, valueObject] of Object.entries(msg.params || {})) {
				const property = gDescriptors.get(name);
				property.value = valueObject;
				const form = byId("formDescriptors");
				applyValueObject(form, property);
			};
			break;
		case "settings.descriptors":
			renderDescriptors(msg.params);
			break;
		case "settings.reload":
			// successful restore from backup
			window.location.reload();
			break;
		case "error":
			console.error("error message", msg.params);
			orcopSettingsError(`${msg.params?.type || ""}${msg.params?.type && ": "}${msg.params?.message}`);
			break;
		default:
			console.warn("orcop_options: unsupported message", msg);
	}
}

function orcopOptionsSubscribe() {
	const port = browser.runtime.connect();
	gOrcopOptions.subscription = port;
	port.onMessage.addListener(orcopOptionsOnMessage);
	port.postMessage({ method: "subscribe", params: "settings" });
}

var gObjectUrl;

async function lrMakeBackup(e) {
	const fileSave = byId("fileSave");
	const divReport = byId("fileReport");
	divReport.innerText = "";
	const dt = (new Date()).toISOString().replace(/:|\..*$/g, "");
	const fileName = `orco-backup-${dt}.txt`
	try {
		if (gObjectUrl) {
			URL.revokeObjectURL(gObjectUrl);
			gObjectUrl = null;
		}
		fileSave.setAttribute("download", fileName);
		const content = JSON.stringify(lrGetFormState(), null, "  ") + "\n";
		console.debug(content);
		const blob = new Blob([content], { type: "text/plain" });
		gObjectUrl = URL.createObjectURL(blob);
		fileSave.href = gObjectUrl;
		divReport.append(E("p", null, `Saved file: ${fileName}`));
	} catch (ex) {
		orcopSettingsError(`${fileName}: ${ex}`);
		e.preventDefault();
		throw ex;
	}
}

function initLoadSave() {
	const fileLoad = byId("fileLoad");
	fileLoad.addEventListener('change', lrOnFileLoad, false);
	const fileSave = byId("fileSave");
	fileSave.addEventListener("click", lrMakeBackup, false);
}

orcopOptionsSubscribe();
initLoadSave();
