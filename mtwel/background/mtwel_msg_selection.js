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

	mtwel_msg_selection.getActiveTab = async function getActiveTab(tab) {
		if (tab != null) {
			if (typeof tab === "number") {
				return await browser.tabs.get(tab);
			}
			return tab;
		}
		const currentTab = await browser.tabs.getCurrent();
		if (currentTab) {
			return currentTab;
		}
		const candidates = await browser.mailTabs.query({
			active: true, currentWindow: true,
		});
		if (!candidates || !(candidates.length > 0)) {
			throw new Error("No active tab");
		}
		if (candidates.length > 1) {
			console.warn("mtwel_msg_selection.getActiveTab: non-unique active tab %o", candidates);
		}
		return (await browser.tabs.get(candidates[0].id)) || candidates[0];
	};

	mtwel_msg_selection.getMessageHeaderArray = async function getMessageHeaderArray(info, tab) {
		// context menu
		let selectedMessages = info?.selectedMessages?.messages;
		if (selectedMessages?.length > 0) {
			return selectedMessages;
		}

		tab = await mtwel_msg_selection.getActiveTab(tab);

		// info.tabId - messageDisplayAction
		const tabId = info?.tabId ?? tab?.id;
		if (tabId == null) {
			throw new Error("Tab unknown, message list unavailable");
		}
		if (browser.messageDisplay?.getDisplayedMessages) {
			// TB 78.4
			selectedMessages = await browser.messageDisplay.getDisplayedMessages(tabId);
			if (selectedMessages?.length > 0) {
				return selectedMessages;
			}
		}
		let message = await browser.messageDisplay?.getDisplayedMessage(tabId);
		if (message) {
			return [message];
		}
		try {
			selectedMessages = await browser.mailTabs.getSelectedMessages?.(tabId);
			if (selectedMessages?.messages?.length > 0) {
				return selectedMessages.messages;
			}
		} catch (ex) {
			// A thunderbird bug: exception when no folder is selected.
			console.error("mtwel_msg_selection.getMessageHeaderArray: browser.mailTabs.getSelectedMessages:", ex);
		}
		if (browser.messageDisplay == null && browser.mailTabs.getSelectedMessages == null) {
			throw new Error("No messagesRead permission");
		}
		return [];
	};

	return mtwel_msg_selection;
}.call(mtwel_msg_selection || new (function mtwel_msg_selection() {})());
