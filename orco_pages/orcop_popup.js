/*
   Copyright (C) 2022 Max Nikulin

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

var gOrcoP = {
	getId: mwel_common.makeGetId("p"),
	elements: {},
};

function orcopPopupOnMessage(msg) {
	try {
		return orcopDoPopupOnMessage(msg);
	} catch (ex) {
		orcopPopupError(ex);
		throw ex;
	}
}

function orcopDoPopupOnMessage(msg) {
	if (msg == null) {
		console.warn("orco popup message: message is null");
		return;
	}
	const params = msg.params;
	switch (msg.method) {
		case "task.status":
			if (params == null) {
				console.warn("orco popup message: task.status: params is null", msg);
				break;
			} else {
				const running = gOrcoP.taskRunning = params?.running;
				gOrcoP.elements.button_main_abort.disabled = !running;
				gOrcoP.elements.button_main_refresh.disabled = running;
				gOrcoP.elements.button_mentions_abort.disabled = !running;
				gOrcoP.elements.button_mentions_refresh.disabled =
					running || !(gOrcoP.selection?.messages?.length > 0);
				gOrcoP.logRing.push({
					id: msg.id,
					...params
				});
			}
			break;
		case "mentions.selection":
			orcopSetMentionsSelection(params);
			gOrcoP.elements.button_mentions_refresh.disabled =
				gOrcoP.taskRunning || !(gOrcoP.selection?.messages?.length > 0);
			break;
		case "orco.mentionsResponse":
			{
				const hasErrors = params.errors?.length > 0;
				if (hasErrors) {
					for (const error of params.errors) {
						gOrcoP.logRing.push({
							id: msg.id,
							priorityNum: orco_common.ERROR,
							status: "error",
							...error,
						});
					}
				}
				gOrcoP.mentions = params?.mentions ?? [];
				gOrcoP.elements.mentions_mentions.replaceChildren(
					orcopRenderMentions(params?.mentions));
				if (!hasErrors && params.mentions?.length > 0) {
					gOrcoP.logRing.push({
						id: msg.id,
						status: "completed",
					});
				}
				break;
			}
		case "orco.reload":
			// Update mentions in the case menu click on a link inside the popup.
			window.history.replaceState(null, null, "#");
			window.location.reload();
			break;
		case "error":
			gOrcoP.logRing.push({
				id: msg.id,
				status: "error",
				...params,
			});
			break;
		case "orco.log":
			gOrcoP.logRing.push(params);
			break;
		default:
			console.warn("unsupported message", msg);
	}
}

function orcopPopupError(error) {
	try {
		console.error(error);
		gOrcoP.logRing.push(error);
	} catch (ex) {
		console.error("orco_popup: while processing error", error);
		console.error(ex);
	}
}

function orcopRenderMentions(mentionsResult, params) {
	const urlMap = mentionsResult && new Map(mentionsResult);
	const fragment = new DocumentFragment;
	const { selection } = gOrcoP;
	const content = selection?.content;
	if (content?.URLs?.length > 0) {
		fragment.append(orcopRenderSelectionCard(content));
		let i = 0;
		for (const link of content.URLs) {
			if (++i > params?.limit) {
				fragment.append(orcopRenderNoMentionsCard(
					`And ${content.URLs.length - params.limit} other links.`));
				break;
			}
			fragment.append(orcopRenderLinkCard(link, params));
			if (urlMap === undefined) {
				continue;
			}
			const href = link.url;
			const mentions = urlMap.get(href);
			fragment.append(
				mentions?.total > 0
				? E("ul", { className: "tree" }, lrp_mentions_view.render(mentions))
				: orcopRenderNoMentionsCard());
			urlMap.delete(href); // TODO it may be referenced later
		}
	}
	let i = 0;
	for (const msg of (selection?.messages || [])) {
		if (++i > params?.limit) {
			fragment.append(orcopRenderNoMentionsCard(
				`And ${selection.messages.length - params.limit} other messages.`));
			break;
		}
		fragment.append(orcopRenderMessageCard(msg, params));
		if (urlMap === undefined) {
			continue;
		}
		const href = 'mid:' + msg.messageID;
		const mentions = urlMap.get(href);
		fragment.append(
			mentions?.total > 0
			? E("ul", { className: "tree" }, lrp_mentions_view.render(mentions))
			: orcopRenderNoMentionsCard());
		urlMap.delete(href); // TODO it may be referenced later
	}
	if (urlMap?.size > 0) {
		console.warn("orcopRenderMentions: results unrelated to selection");
		for (const [url, mentions] of urlMap.entries()) {
			fragment.append(
				orcopRenderLinkCard({ url }),
				lrp_mentions_view.render(mentions));
		}
	}
	return fragment;
}

function orcopSetMentionsSelection(params) {
	if (params == null || !(params.error || params.messages || params.content)) {
		throw new Error("Invalid message: selection");
	}
	gOrcoP.selection = params;
	try {
		if (params.error) {
			// Error may be partial: successful selection but failed messages.
			orcopPopupError(params.error);
		}
	} catch (ex) {
		console.error("orcopSetMentionsSelection: exception while reporting error", ex);
	}
	const fragment = new DocumentFragment;
	try {
		if (params.error) {
			const txt = "Mentions: error: " + params.error.message;
			fragment.append(orcopRenderNoMentionsCard(txt));
		}
		if (params.messages?.length === 0) {
			fragment.append(orcopRenderNoMentionsCard("No messages selected"));
		} else if (!(params.messages?.length > 0 || params.content != null || params.error != null)) {
			console.warn("orcopSetMentionsSelection: neither messages no error is set");
			fragment.append(orcopRenderNoMentionsCard("Mentions: internal error"));
		}
	} catch (ex) {
		orcopPopupError(ex);
		try {
			fragment.append(orcopRenderNoMentionsCard("Mentions: internal error"));
		} catch (ex2) {
			console.error("orcopSetMentionsSelection", ex2);
		}
	}
	try {
		const fragmentMain = fragment.cloneNode(true);
		fragmentMain.append(orcopRenderMentions(undefined, { active: false, limit: 1, }));
		gOrcoP.elements.text_main_mentions.replaceChildren(fragmentMain);
	} catch (ex) {
		orcopPopupError(ex);
	}
	try {
		fragment.append(orcopRenderMentions(undefined));
		gOrcoP.elements.mentions_mentions.replaceChildren(fragment);
	} catch (ex) {
		orcopPopupError(ex);
	}
	if (params.userAction) {
		orcopActionHandlers.mentions();
	}
}

function orcopPopupStartTask(method, params) {
	let id = gOrcoP.getId();
	gOrcoP.port.postMessage({ method, params, id, });
	gOrcoP.logRing.push({
		id,
		topic: params.topic,
		status: "starting…",
	});
}

var orcopActionHandlers = {
	abort() {
		gOrcoP.port.postMessage({ method: "task.abort", params: { taskId, }, });
		orcopPopupStartTask("task.abort", { topic: "Abort" });
	},
	back(link) {
		orcopPopupSwitchPage(link, true);
	},
	logCopy() {
		const text = gOrcoP.logRing.getText();
		console.log("copy", text);
		if (text) {
			if (!mwel_clipboard.copyUsingEvent(text)) {
				throw new Error("Copy failed");
			}
		}
	},
	logClear() {
		gOrcoP.logRing.clear();
		orcopPopupStartTask("orco.logClear", { topic: "Clear log" });
	},
	mentions(link) {
		if (!gOrcoP.mentions) {
			orcopActionHandlers.mentionsRefresh();
		}
		orcopPopupSwitchPage(link || "page_mentions");
	},
	mentionsRefresh() {
		if (gOrcoP.selection == null) {
			return;
		}
		const messages = gOrcoP.selection.messages?.map(m => 'mid:' + m.messageID);
		const content = gOrcoP.selection.content?.URLs?.map(u => u.url);
		if (messages === undefined && content === undefined) {
			return;
		}
		orcopPopupStartTask("orco.mentions", {
			topic: "Mentions",
			URLs: [ ...(messages || []), ...(content || []), ],
		});
	},
	visit(link) {
		const path = link.dataset.orcoPath;
		const query = { path };
		const lineNo = parseInt(link.dataset.orcoLineNo, 10);
		if (lineNo >= 0) {
			query.lineNo = lineNo;
		}
		if (!path) {
			throw new Error("Internal error: no file path to visit");
		}
		orcopPopupStartTask("orco.visit", {
			topic: "visit",
			...query,
		});
	},
	refresh() {
		orcopPopupStartTask("orco.refresh", { topic: "Refresh" });
	},
	settings() {
		gOrcoP.port.postMessage({ method: "orco.settings" });
	},
};

function opcopExecAction(element) {
	// Move try-catch to the caller
	try {
		const action = element.name || element.dataset.orcoAction;
		if (action === undefined) {
			return false;
		}
		const handler = orcopActionHandlers[action];
		if (handler === undefined) {
			throw new Error(`Internal: Unhandled action "${action}"`);
		}
		handler(element);
	} catch (ex) {
		orcopPopupError(ex);
	}
	return true;
}

function orcopPopupSwitchPage(target, back) {
	let from = window.history.state?.from;
	if (!Array.isArray(from)) {
		from = [];
	}
	let selected;
	let item;
	if (back) {
		item = from?.pop?.();
		if (item !== undefined && item !== "") {
			selected = byId(item);
		}
	}
	if (selected === undefined) {
		item = typeof target === "string" ?
			target : target.getAttribute?.("href")?.substring(1);
		selected = byId(item);
	}
	if (selected == undefined) {
		// FIXME: make it the log entry
		console.error(`No menu handler for "${item}"`);
		return true;
	}
	for (const menu of document.getElementsByClassName("menu-page")) {
		if (menu.getAttribute("id") === item) {
			selected = menu;
		} else {
			menu.classList.add("display-none");
		}
	}
	selected.classList.remove("display-none");
	if (back) {
		from.pop();
	} else {
		from.push(window.location.hash.substring(1));
	}
	window.history.replaceState({ from }, null, "#" + item);
}

function orcopPopupOnMenu(evt) {
	let target = evt.target;
	for ( ; target != undefined; target = target.parentElement) {
		if (target.matches('a[role="menuitem"]')) {
			break;
		}
	}
	if (target == undefined) {
		return false;
	}
	// TODO check role
	evt.preventDefault();
	evt.stopImmediatePropagation();
	if (opcopExecAction(target)) {
		return true;
	}
	orcopPopupSwitchPage(target);
	return true;
}

function orcopPopupOnClick(evt) {
	for (let target = evt.target; target != undefined; target = target.parentElement) {
		if (opcopExecAction(target)) {
			evt.preventDefault();
			evt.stopImmediatePropagation();
			return true;
		}
	}
	if (orcopPopupOnMenu(evt) === true) {
		return;
	}
	for (let target = evt.target; target != undefined; target = target.parentElement) {
		if (target.nodeName === "BUTTON") {
			console.error("orcop_popup: unhanlded", target);
			break;
		}
	}
}

class OrcopLogRing {
	constructor(capacity = 5) {
		this.entries = [];
		this.capacity = capacity;
		this._tasks = [];
	}
	summary(entry, maxPriorityNum) {
		if (entry === undefined && !(this.entries.length > 0)) {
			return {
				priority: orcopPriorityIcon[orco_common.INFO],
				message: "Nothing logged yet",
			};
		}
		const first = entry ?? this.entries[0];
		const priorityNum = first.priorityNum;
		if (maxPriorityNum === undefined) {
			maxPriorityNum = priorityNum;
			for (
				let i = maxPriorityNum === orco_common.ERROR ? this.entries.length : 1 ;
				i < this.entries.length;
				++i
			) {
				const p = this.entries[i].priorityNum;
				if (!(maxPriorityNum >= p)) {
					maxPriorityNum = p;
					if (p === orco_common.ERROR) {
						break;
					}
				}
			}
		}
		let priority = priorityNum != null ? orcopPriorityIcon[priorityNum] : "";
		const maxText = maxPriorityNum != null ? orcopPriorityIcon[maxPriorityNum] : "";
		if (maxText && maxText !== priority) {
			priority += "/" + maxText;
		}
		return {
			message: ["topic", "status", "message"].map(f => first[f]).filter(t => !!t).join(": "),
			priority,
			ts: first.ts,
		};
	}
	clear() {
		this.entries.splice(0);
		this._tasks.splice(0);
	}
	push(props) {
		if (props instanceof Error) {
			props = orco_common.errorDescription(props);
			props.topic = "Error";
		}
		const iExisting = props.id === undefined ?
			-1 : this._tasks.findIndex(e => e.id === props.id);
		if (iExisting === 0) {
			;
		} else if (iExisting > 0) {
			const existing = this._tasks.splice(iExisting, 1);
			this._tasks.unshift(existing);
		} else {
			if (!(this.capacity > this._tasks.length)) {
				let iCandidate = this.tasks.length - 1;
				if (
					!props.persistent &&
					this._tasks[iCandidate].persistent &&
					!this._tasks[iCandidate - 1].persistent
				) {
					--iCandidate;
				}
				const id = this._tasks.splice(iCandidate, 1)[0].id;
				this.entries = this.entries.filter(e => e !== id);
			}
			this._tasks.unshift({
				id: props.id ?? gOrcoP.getId(),
				topic: props.topic,
				persistent: props.persistent,
			});
		}
		const task = this._tasks[0];
		this.entries.unshift(orcopLogEntry(props, task));
		this._update();
		return task.id
	}
	getText() {
		const buffer = [];
		for (const entry of this.entries) {
			const header = [];
			if (entry.ts) {
				header.push(new Date(entry.ts).toISOString());
			}
			header.push(orcopPriorityText[entry.priorityNum] ?? "unknown");
			for (const field of [ "topic", "status", "type", "message" ]) {
				const value = entry[field];
				if (value != null && value !== "") {
					header.push(orco_common.safeString(value));
				}
			}
			if (header.length !== 0) {
				buffer.push(header.join(" "));
			}
			const { details } = entry;
			if (details == null || details === "") {
				continue;
			}
			if (Array.isArray(details)) {
				buffer.push(...details);
			} else {
				buffer.push(String(details));
			}
		}
		return buffer.join("\n");
	}
	_update() {
		if (this.onupdate) {
			try {
				this.onupdate(this);
			} catch (ex) {
				console.error("OrcopLogRing.onupdate", ex);
			}
		}
	}
}

function orcopLogEntry(entry, task) {
	const props = { ...entry };
	if (props.id == null) {
		props.id = task.id;
	}
	if (props.topic == null) {
		props.topic = task.topic;
	}
	if (props.ts == null) {
		props.ts = Date.now();
	}
	if (props.priorityNum == null) {
		props.priorityNum = orco_common.INFO;
	}
	return props;
}

var orcopPriorityIcon = function() {
	const map = {};
	for (const [name, text] of Object.entries({
		DEBUG: "D", INFO: "\u{2139}" /* info */, WARNING: "\u{26a0}" /* alert */, ERROR: "E",
	})) {
		map[orco_common[name]] = text;
	}
	return map;
} ();

var orcopPriorityText = function() {
	const map = {};
	for (const name of [
		"DEBUG", "INFO", "WARNING", "ERROR",
	]) {
		map[orco_common[name]] = name.toLowerCase();
	}
	return map;
} ();

function orcopMakeTimeFormatter() {
	function fallbackTimeFormatter(d) {
		try {
			return d.toTimeString();
		} catch (ex) {
			console.error("orcopMakeTimeFormatter.fallbackTimeFormatter", ex);
		}
		return "";
	}
	try {
		const timeFormat = new Intl.DateTimeFormat([], { timeStyle: "short" });
		const dateFormat = new Intl.DateTimeFormat([], { dateStyle: "short" });
		const now = new Date();
		const dateThreshold = Math.min(new Date(
			now.getYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0).valueOf(),
			new Date(now.valueOf() - 12*3600*1000));
		return function intlFormatter(d) {
			try {
				return d.valueOf() > dateThreshold ? timeFormat.format(d) : dateFormat.format(d);
			} catch (ex) {
				console.error("orcopMakeTimeFormatter.intlFormatter", ex);
			}
			return fallbackTimeFormatter(d);
		}
	} catch (ex) {
		console.error("orcopMakeTimeFormatter", ex);
	}
	return fallbackTimeFormatter;
}

function orcopOnPopupLogRingUpdate(logRing) {
	const dtFormatter = orcopMakeTimeFormatter();

	try {
		const { priority, message, ts } = logRing.summary();
		const time = typeof ts === "number" ? dtFormatter(new Date(ts)) : "";
		for (const id of [ "log_message_main", "log_message_mentions" ]) {
			const element = gOrcoP.elements[id];
			element.getElementsByClassName("message")[0].replaceChildren(message);
			element.getElementsByClassName("date")[0].replaceChildren(time);
			element.getElementsByClassName("icon")[0].replaceChildren(priority);
		}
	} catch (ex) {
		console.error("orcopOnPopupLogRingUpdate: main", ex);
	}
	const maxPriority = new Map();
	const entries = [];
	for (const entry of logRing.entries) {
		const max = maxPriority.get(entry.id);
		if (max === undefined) {
			entries.push(entry);
		}
		const priority = entry.priorityNum;
		if (!(max >= priority)) {
			maxPriority.set(entry.id, priority);
		}
	}
	for (let i = 0; i < logRing.capacity; ++i) {
		try {
			const element = byId("log_message_" + i);
			const entry = entries[i];
			const hiddenClass = "hidden";
			let message = "";
			let ts = "";
			let priority = "";
			if (entry !== undefined) {
				({ ts, priority, message } = gOrcoP.logRing.summary(entry, maxPriority.get(entry.id)));
				element.classList.remove(hiddenClass);
			} else {
				element.classList.add(hiddenClass);
			}
			element.getElementsByClassName("text")[0].replaceChildren(message ?? "");
			/*
			const details = entry?.details;
			element.getElementsByClassName("text-shortcut")[0].replaceChildren(
				details ? (Array.isArray(details) ? details.join("\n") : String(details)) : "");
				*/
			element.getElementsByClassName("icon")[0].replaceChildren(priority ?? "");
			element.getElementsByClassName("date")[0].replaceChildren(
				typeof ts === "number" ? dtFormatter(new Date(ts)) : "");
		} catch (ex) {
			console.error("orcopOnPopupLogRingUpdate: entry", i, ex);
		}
	}
}

function orcopRenderMessageCard(msg, params) {
	const { from, to, date, subject } = msg;
	const firstLine = [ E(
		"span",
		{ className: "icon", "aria-label": "Message" },
		"\u{2709}" /* Envelope */) ];
	if (from) {
		firstLine.push(E("span", null, from));
	}
	if (to) {
		firstLine.push(E("span", null, "to " + to));
	}
	if (date) {
		const dateFormatter = new Intl.DateTimeFormat([], { timeStyle: "short", dateStyle: "short" });
		firstLine.push(E('time', { datetime: date.toISOString() }, dateFormatter.format(date)));
	}
	const other = [];
	if (subject) {
		other.push(E('div', { className: "card-subject" }, subject));
	}
	if (msg.messageID) {
		const href = 'mid:' + msg.messageID;
		other.push( E("div", null, params?.active !== false ? E("a", { href }, href) : href));
	}
	return E('div', { className: "card" },
		E('div', { className: "card-message-addresses" }, ...firstLine),
		E('div', { className: "card-other" }, ...other));
}

function orcopRenderLinkCard(link, params) {
	const href = link.url;
	// TODO icon depending on .source
	if (link.messages?.length > 0) {
		const fragment = new DocumentFragment();
		for (const msg of link.messages) {
			fragment.append(orcopRenderMessageCard(msg, params));
		}
		return fragment;
	} else {
		const header = [
			E(
				"span",
				{ className: "icon", "aria-label": "Link", rel: "icon" },
				"\u{1F517}" /* Link */),
			E("span", null,
				params?.active !== false
				? E("a", { href, rel: "noopener noreferrer" }, href)
				: href),
		];
		return E('div', { className: "card" },
			E('div', { className: "card-link" }, ...header));
	};
}

function orcopRenderSelectionCard(content) {
	const fragment = new DocumentFragment();
	if (content?.selectionText) {
		fragment.append(
			E("div", { className: "card-link selection-quote" },
				E("span", { className: "selection-text" }, content.selectionText)));
	}
	if (content?.linkText) {
		fragment.append(
			E("div", { className: "card-link" },
				E("span", { className: "selection-text" }, content.linkText)));
	}
	return fragment;
}

function orcopRenderNoMentionsCard(text) {
	return E('div', null, text ?? "No mentions");
}

if (typeof browser === "undefined") {
	console.log("Activating debug outside of WebExtension");
	var browser = {
		runtime: {
			connect() {
				return {
					onMessage: {
						addListener() { console.log("Port.onMessage.addEventListener: ignored");},
					},
					postMessage(msg) { console.log("Port.postMessage: ignored", msg); },
				};
			},
		},
	};
}

async function orcopPopupAsyncMain() {
	gOrcoP.port = browser.runtime.connect(undefined);
	gOrcoP.port.onMessage.addListener(orcopPopupOnMessage);
	gOrcoP.port.postMessage({ method: "subscribe", params: "popupNotifications" });
	const elements = [
		"button_main_abort", "button_main_refresh",
		"button_mentions_abort", "button_mentions_refresh",
		"log_message_main", "log_message_mentions",
		"text_main_mentions", "mentions_mentions",
	];
	for (const id of elements) {
		const e = byId(id);
		if (e === null) {
			console.warn("Element not found: '%o'", id);
		}
		gOrcoP.elements[id] = e;
	}
	window.addEventListener("click", orcopPopupOnClick, false);
	gOrcoP.logRing = new OrcopLogRing();
	gOrcoP.logRing.onupdate = orcopOnPopupLogRingUpdate;
	window.addEventListener("error", function(evt) {
		gOrcoP.logRing.push(evt.error ?? {
			topic: "Error", message: evt.message,
			details: "filename: " + evt.filename,
			priorityNum: orco_error.ERROR,
		});
	});
}

orcopPopupAsyncMain().catch(ex => {
	orcopPopupError(ex);
});

console.assert(
	typeof mwel_clipboard !== "undefined" && mwel_clipboard?.copyUsingEvent?.call !== undefined,
	"mwel_clipboard is loaded");
console.assert(
	typeof lrp_mentions_view !== "undefined" && lrp_mentions_view?.render?.call !== undefined,
	"lrp_mentions_view is loaded");
