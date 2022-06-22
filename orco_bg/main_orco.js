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

var con = con || console;
var gOrcoB = orcoMakeGlobal(gOrcoB);

function orcoMakeGlobal(orco) {
	if (orco !== undefined) {
		return orco;
	}
	orco = {};
	const props = {
		SETTING_PREFIX: "burl.linkPrefix",
		SETTING_BACKEND: "burl.backend",
		MAX_MENTIONS_MESSAGES: 4,
		// Column value mapping.
		// Transparent for structured clone and no type conversion
		// during getting of `Object` properties.
		TRUE_VALUE: "1",
	};
	for (const [ key, value ] of Object.entries(props)) {
		Object.defineProperty(orco, key, {
			value,
			writable: false,
			enumerable: true,
			configurable: true,
		});
	}
	orco.getId = mwel_common.makeGetId("b");
	orco.singleTask = new OrcoSingleTask(orco.getId);
	return orco;
}

class OrcoBackendSettings {
	constructor(orco) {
		this._orco = orco;
	}
	get backend() {
		return this._orco.addonSettings.getOption(this._orco.SETTING_BACKEND);
	}
	get prefix() {
		return this._orco.addonSettings.getOption(this._orco.SETTING_PREFIX);
	}
}

function orcoRegisterSettings() {
	// Since this is a thunderbird-only extension, `browser.runtime.id`
	// should not cause any problem as well.
	const settings = new LrSettings(
		"io.github.maxnikulin.orco", browser.storage.local);
	gOrcoB.addonSettings = settings;
	browser.storage.onChanged.addListener(settings.changedListener);
	settings.registerGroup({
		name: "burl",
		title: "Message-ID Extraction",
		priority: 50,
	});
	settings.registerOption({
		name: gOrcoB.SETTING_BACKEND,
		defaultValue: null,
		title: "Native messaging application (host)",
		version: "0.1",
		description: [
			"The extension requires a helper application running outside of Thunderbird.",
			"Please, install https://github.com/maxnikulin/burl/",
			"Create native messaging manifest and specify name (identifier)",
			"of the application",
			"\n",
			"See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging",
			"for details how to configure native messaging application.",
		],
		parent: "burl",
	});
	settings.registerOption({
		name: gOrcoB.SETTING_PREFIX,
		defaultValue: "mid:, news:, nntp:\nhttps://mid.mail-archive.com/\nhttp://mid.mail-archive.com/",
		title: "Prefixes to extract Message-ID links",
		version: "0.1",
		type: "text",
		description: [
			"URI schemes and prefixes to extract links containing Message-ID.",
			"Add e.g. https://list.orgmode.org/ and https://orgmode.org/list/",
			"if you have links to the public inbox archive of the emacs-orgmode mail list",
			"in your notes.",
			"\n",
			"Newline or space separated list.",
		],
		parent: "burl",
	});
}

async function orcoAddColumn() {
	browser.cucolapi.add(
		{
			// Unicorn emoji
			id: "orgCol", label: "\u{1F984}", tooltip: "Sort by mention in Org",
			fixed: true,
			mapping: {
				valueType: "text",
				field: "messageId",
				display: {
					[gOrcoB.TRUE_VALUE]: "\u{1F984}"
				},
			},
		},
	);
}

async function orcoRefresh(lock) {
	const [map, set] = await gOrcoB.backend.getLinkSet(null, lock);
	gOrcoB.map = map;
	const trueValue = gOrcoB.TRUE_VALUE;
	const orgCol = [];
	for (const id of set) {
		orgCol.push([id, trueValue]);
	}
	await browser.cucolapi.updateData({ orgCol } );
}

function orcoInitPubSub() {
	gOrcoB.pubsub = new OrcoPubSubService();
	browser.runtime.onConnect.addListener(gOrcoB.pubsub.onConnect);
}

function orcoInitMenuHandler() {
	gOrcoB.mentions = new OrcoMentions(gOrcoB.MAX_MENTIONS_MESSAGES);
	browser.menus.onClicked.addListener(
		function orcoMenusListner(info, tab) {
			if (info?.menuItemId !== "ORCO_MENTIONS") {
				throw new Error(`Unsupported menu entry "${info?.menuItemId}"`);
			}
			// TODO log error, notice no `await` despite calls of `async` functions.
			gOrcoB.mentions.storeMenusContext(info, tab);
			// For Chrome `openPopup` is supported only for `action` API since manifest v3.
			// `openPopup` must be executed from user action context,
			// so no `await` is allowed before.
			// There is no `browser_action` in `messageDisplay` windows,
			// so `command` as menu item action is not possible.
			// https://bugzilla.mozilla.org/1775246
			// "browserAction buttons missed in messageDisplay windows"
			browser.messageDisplayAction.openPopup();
			browser.browserAction.openPopup();
		});
}

function orcoRegisterPopupSubscription() {
	const server = gOrcoB.popupSubscription =
		new OrcoSubscriptionHandler(browser.runtime.id);
	server.register("orco", {
		async settings() {
			await browser.runtime.openOptionsPage();
		},
		async refresh(msg) {
			await gOrcoB.singleTask.run(
				{ id: msg.id, ...(msg.params || {}) },
				lock => orcoRefresh(lock));
		},
		async mentions(msg, port) {
			if (!(msg.params?.URLs?.length > 0)) {
				throw new Error("No Message-ID list to check");
			}
			const { URLs, ...other } = msg.params;
			// TODO LRU cache in OrcoMentions
			const response = await gOrcoB.singleTask.run(
				{ id: msg.id, ...other },
				lock => gOrcoB.backend.mentions({ URLs, map: gOrcoB.map, }, lock));
			await port.postMessage({
				id: msg.id, method: "orco.mentionsResponse",
				params: response,
			});
		},
		async visit(msg, port) {
			const { messageIDs, path, lineNo, ...other } = msg.params;
			const response = await gOrcoB.singleTask.run(
				{ id: msg.id, other },
				lock => gOrcoB.backend.visit({ path, lineNo }, lock));
		},
		logClear() {
			con.debug("popup pub/sub: orco.logClear: not implemented"); // TODO
		},
	});
	server.register("task", {
		abort() { gOrcoB.singleTask.abort(); },
	});
	const addSource = gOrcoB.pubsub.register("popupNotifications", server);
	addSource(gOrcoB.singleTask.eventSource);
	addSource(gOrcoB.mentions.eventSource);
}

function orcoRegisterSettignsSubscription() {
	const server = gOrcoB.settingsSubscription =
		new OrcoSubscriptionHandler(browser.runtime.id);
	const eventSource = new OrcoPubEventSource(function* orcoSettingsPubSubGreet() {
		yield { method: "settings.descriptors", params: gOrcoB.addonSettings.getDescriptors(), };
	});
	server.register("settings", {
		async change(msg) {
			const diff = await gOrcoB.addonSettings.update(msg.params);
			// TODO Emit event from `LrSettigs._changeListener()`.
			if (msg.params?.[1]) {
				eventSource.notify({
					method: "settings.reload",
					id: msg.id,
				});
			} else {
				eventSource.notify({
					method: "settings.update",
					params: diff,
					id: msg.id,
				});
			}
		}
	});
	const addSource = gOrcoB.pubsub.register("settings", server);
	addSource(eventSource);
}

function orcoEnableMessageDisplayAction(win) {
	if (win.type !== "messageDisplay") {
		con.debug("orcoEnableMessageDisplayAction: ignore window", win);
		return;
	}
	console.assert(win?.tabs?.length === 1, "messageDisplay window has 1 tab", win);
	if (win.tabs == null) {
		return;
	}
	for (const tab of win.tabs) {
		const tabId = tab.id;
		if (tabId == null) {
			con.warn("tab.id is null", tab, win);
			continue;
		}
		browser.messageDisplayAction.enable(tabId);
	}
}

function orcoOnWindowCreated(win) {
	if (win.type !== "messageDisplay") {
		con.debug("orcoOnWindowCreated: ignore window", win);
		return;
	}
	browser.windows.get(win.id, { populate: true })
		.then(orcoEnableMessageDisplayAction);
	// TODO try-catch and report error to background logger
}

async function orcoDisableMessageDisplayAction(win) {
	browser.messageDisplayAction.disable();
	const messageWindows = await browser.windows.getAll(
		{ windowTypes: ["messageDisplay"], populate: true });
	browser.windows.onCreated.addListener(orcoOnWindowCreated);
	const errors = [];
	for (const win of messageWindows) {
		try {
			orcoEnableMessageDisplayAction(win);
		} catch (ex) {
			con.error(ex);
			errors.push(ex);
		}
	}
	switch (errors.length) {
		case 0:
			break;
		case 1:
			throw errors[0];
			break;
		default:
			throw new AggregateError(errors, "Failed to enable messageDisplayAction");
			break;
	}
}

async function orcoCreateMenu() {
	await browser.menus.removeAll();
	function orcoOnMenusCreated() {
		const error = browser.runtime.lastError;
		if (error) {
			con.error("menus create error: %o", error);
		}
	}
	browser.menus.create({
		// Ignore `folder_pane` included into `all`.
		// Unsure if `editable` and `password` should be added.
		contexts: [ "message_list", "page", "frame", "selection", "link", "image", "video", "audio", ],
		id: "ORCO_MENTIONS",
		title: browser.i18n.getMessage("cmdMentions"),
		// `command: "_execute_browser_action"`, a Mozilla extension,
		// can not be used here since `messageDisplay` windows
		// do not have `browserAction`, so `messageDisplayAction` is used there.
		// Approach like `menus.refresh()` (expensive, so discouraged)
		// might be used for switching between visibility of 2 menu items
		// unless there is some problem due to `async` functions necessary to
		// determine window type. Notice that `menus.update` can not be used
		// to change `command`.
	}, orcoOnMenusCreated);
}

function orcoSyncMain() {
	const initializers = [
		orcoRegisterSettings,
		orcoInitMenuHandler,
		orcoInitPubSub,
		orcoRegisterPopupSubscription,
		orcoRegisterSettignsSubscription,
	];
	for (const func of initializers) {
		try {
			func();
		} catch (ex) {
			// FIXME to log accessible from the popup
			con.error(" sync main: %o: %o", func.name, ex);
		}
	}
}

async function orcoAsyncMain() {
	await gOrcoB.addonSettings.initAsync();
	const initializers = [
		orcoAddColumn,
		orcoDisableMessageDisplayAction,
		orcoCreateMenu,
	];
	for (const func of initializers) {
		try {
			await func();
		} catch (ex) {
			// FIXME to log accessible from the popup
			con.error("async main: %o: %o", func, ex);
		}
	}
	const backendSettings = new OrcoBackendSettings(gOrcoB);
	gOrcoB.backend = new OrcoBurlBackend(backendSettings);
	// TODO fetch data only if a column is really added
	// - a class that communicate with native messaging application
	// - a class that fetches settings and run the task through SingleTask
	// FIXME avoid duplicated error reports
	gOrcoB.singleTask.run({ topic: "Load" }, lock => orcoRefresh(lock));
	con.debug("loaded");
}

orcoSyncMain();
orcoAsyncMain();
