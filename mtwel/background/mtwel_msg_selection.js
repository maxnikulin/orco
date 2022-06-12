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

var mtwel_msg_selection = function mtwel_msg_selection_load() {
	const mtwel_msg_selection = this;

	/** Selection of multiple tabs is not supported in Thunderbird-91
	 * Tabs are implemented in a quite peculiar way:
	 * https://bugzilla.mozilla.org/487386
	 * "tabs don't maintain exactly what was shown when" 2009
	 * https://bugzilla.mozilla.org/1758243
	 * "Move message to new window creates spurious tab with folder list" 2022
	 */
	mtwel_msg_selection.getHighlightedMailTabIds = async function getHighlightedMailTabIds(tab) {
		if (tab != null) {
			if (typeof tab === "number") {
				return [ tab ];
			}
			const tabId = tab?.id;
			if (tabId != null) {
				return [ tabId ];
			}
		}
		// The following does not work from the backgrownd page or an action popup:
		//     const currentTab = await browser.tabs.getCurrent();

		function _filterMailTabs(tabs) {
			if (tabs == null || !(tabs.length > 0)) {
				return undefined;
			}
			tabs = tabs.filter(t => t.type === "messageDisplay" || t.type === "mailTab");
			return tabs.length > 0 ? tabs.map(t => t.id) : undefined;
		}

		// Thunderbird-91 reports unexpected error for `{ highlighted: true }`:
		//     Not implemented ext-tabs-base.js:1193
		//         getHighlightedTabs chrome://extensions/content/parent/ext-tabs-base.js:1193
		// so actually `{ active: true }`
		async function _query(params) {
			for (const selector of [ { highlighted: true }, { active: true } ]) {
				try {
					return await browser.tabs.query({ ...params, ...selector });
				} catch (ex) {
					console.error("mtwel_msg_selection.getHighlightedMailTabIds: ignored error", ex);
				}
			}
			return undefined;
		}

		function _toIds(mailTabs) {
			if (mailTabs == null || !(mailTabs.length > 0)) {
				return undefined;
			}
			return mailTabs.map(t => t.id);
		}

		let tabs = _filterMailTabs(await _query({ currentWindow: true })) ??
			_filterMailTabs(await _query({ lastFocusedWindow: true })) ??
			// Likely never used, it is fallback because it
			// ignores `{ type: "messageDisplay" }` tabs
			// and `{ highlighted: true }` option is not supported.
			_toIds(await browser.mailTabs.query(
				{ active: true, currentWindow: true, }));

		if (tabs == null) {
			throw new Error("No active tab");
		}
		return tabs;
	};

	mtwel_msg_selection.getMessageHeaderArray = async function getMessageHeaderArray(info, tab) {
		// context menu
		let selectedMessages = info?.selectedMessages?.messages;
		if (selectedMessages?.length > 0) {
			return selectedMessages;
		}

		// info.tabId - messageDisplayAction
		const argTabId = info?.tabId ?? tab?.id;
		let tabIdArray = argTabId != null ?
			[ argTabId ] :
			await mtwel_msg_selection.getHighlightedMailTabIds(tab);

		if (tabIdArray == null) {
			throw new Error("Tab unknown, message list unavailable");
		}
		const retval = [];
		for (const tabId of tabIdArray) {
			if (browser.messageDisplay?.getDisplayedMessages) {
				// TB 78.4
				selectedMessages = await browser.messageDisplay.getDisplayedMessages(tabId);
				if (selectedMessages?.length > 0) {
					retval.push(...selectedMessages);
					continue
				}
			}
			let message = await browser.messageDisplay?.getDisplayedMessage(tabId);
			if (message) {
				retval.push(message);
			}
			try {
				selectedMessages = await browser.mailTabs.getSelectedMessages?.(tabId);
				if (selectedMessages?.messages?.length > 0) {
					retval.push(...selectedMessages.messages);
					continue;
				}
			} catch (ex) {
				// A thunderbird bug: exception when no folder is selected.
				console.error("mtwel_msg_selection.getMessageHeaderArray: browser.mailTabs.getSelectedMessages:", ex);
			}
		}
		if (
			!(retval.length > 0) &&
			browser.messageDisplay == null &&
			browser.mailTabs.getSelectedMessages == null
		) {
			throw new Error("No messagesRead permission");
		}
		return retval;
	};

	return mtwel_msg_selection;
}.call(mtwel_msg_selection || new (function mtwel_msg_selection() {})());
