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
	mtwel_msg_selection.getActionTabs = async function getActionTabs(info, tab) {
		try {
			const clickTabId = info?.tabId;
			if (clickTabId >= 0) {
				const clickTab = tab?.id === clickTabId ? tab : await browser.tabs.get(clickTabId);
				if (clickTab?.id === clickTabId) {
					return [ clickTab ];
				}
				console.warn(
					"mtwel_msg_selection.getActionTabs: tabs.get returned wrong tab:",
					clickTabId, clickTab);
			}
		} catch (ex) {
			console.warn(
				"mtwel_msg_selection.getActionTabs: exception while processing clickData.tabId",
				ex);
		}
		if (tab?.id >= 0) {
			return [ tab ];
		}

		function _hasEntries(mailTabs) {
			if (mailTabs == null || !(mailTabs.length > 0)) {
				return undefined;
			}
			return mailTabs;
		}

		const tabs = _hasEntries(await mtwel_util.getHighlightedMailTabs()) ??
			// Likely never used, it is fallback because it
			// ignores `{ type: "messageDisplay" }` tabs
			// and `{ highlighted: true }` option is not supported
			// in Thunderbird-91, fix backported to Thunderbird-102.
			// https://bugzilla.mozilla.org/1773977
			// tabs.query({highlighted: true}): Error: An unexpected error occurred undefined
			_hasEntries(await browser.mailTabs.query(
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

		let tabArray = await mtwel_msg_selection.getActionTabs(info, tab);

		if (tabArray == null) {
			throw new Error("Tab unknown, message list unavailable");
		}
		const retval = [];
		const errors = [];
		for (const tabA of tabArray) {
			const tabId = tabA.id;
			if (typeof tabId !== "number") {
				console.warn(
					"mtwel_msg_selection.getMessageHeaderArray: tab.id is not a number",
					tabA);
				continue;
			}
			if (tabA?.type === "messageCompose") {
				try {
					const composeDetails = await browser.compose.getComposeDetails(tabId);
					if (composeDetails) {
						retval.push(composeDetails);
						continue;
					}
				} catch (ex) {
					orco_common.addErrorStack(ex);
					console.warn(
						"mtwel_msg_selection: compose.getComposeDetails",
						"will try fallback due to exception",
						ex);
				}
			}
			try {
				// TB >= 78.4
				selectedMessages = await browser.messageDisplay?.getDisplayedMessages?.(tabId);
				if (selectedMessages?.length > 0) {
					retval.push(...selectedMessages);
					continue
				}
			} catch (ex) {
				orco_common.addErrorStack(ex);
				if (ex.message === "An unexpected error occurred") {
					// Thunderbird-91 and 102 can not handle message opened from a `.eml` file.
					//  msgHdr.getProperty is not a function ext-mail.js:1704
					// https://bugzilla.mozilla.org/1784047
					// "`messageDisplay.getDisplayedMessages: Error: An unexpected error occurred`
					// when opened from an .eml file"
					console.log(
						"mtwel_msg_selection.getMessageHeaderArray:",
						"messageDisplay.getDisplayedMessages:",
						"ignoring exception, likely Bug #1784047:",
						"message from an .eml file",
						ex);
				} else {
					errors.push(ex);
					console.warn(
						"mtwel_msg_selection: messageDisplay.getDisplayedMessages:",
						"will try fallback due to exception:",
						ex);
				}
			}
			try {
				let message = await browser.messageDisplay?.getDisplayedMessage?.(tabId);
				if (message) {
					retval.push(message);
				}
			} catch (ex) {
				orco_common.addErrorStack(ex);
				if (ex.message === "An unexpected error occurred") {
					// Thunderbird-91 can not handle message opened from a `.eml` file.
					//  msgHdr.getProperty is not a function ext-mail.js:1704
					console.log(
						"mtwel_msg_selection.getMessageHeaderArray:",
						"messageDisplay.getDisplayedMessage:",
						"ignoring exception, likely Bug #1784047:",
						"message from an .eml file",
						ex);
				} else {
					errors.push(ex);
					console.warn(
						"mtwel_msg_selection: messageDisplay.getDisplayedMessage:",
						"will try fallback due to exception:",
						ex);
				}
			}
			try {
				selectedMessages = await browser.mailTabs.getSelectedMessages?.(tabId);
				if (selectedMessages?.messages?.length > 0) {
					retval.push(...selectedMessages.messages);
					continue;
				}
			} catch (ex) {
				orco_common.addErrorStack(ex);
				if (ex.message === "An unexpected error occurred") {
					// Thunderbird-91 bug: exception when account instead of folder is selected.
					// https://bugzilla.mozilla.org/1773972
					// "mailTabs.getSelectedMessages: Error: An unexpected error occurred"
					// Fixed in Thunderbird-105)
					console.log(
						"mtwel_msg_selection.getMessageHeaderArray:",
						"mailTabs.getSelectedMessages:",
						"ignore exception, likely Bug #1773972:",
						"no messages selected because account is chosen",
						ex);
				} else {
					errors.push(ex)
					console.warn(
						"mtwel_msg_selection: browser.mailTabs.getSelectedMessages:",
						ex);
				}
			}
		}
		if (!(retval.length > 0)) {
			if (errors.length > 0) {
				throw new AggregateError(errors, "Get selected messages failed");
			}
			if (
				browser.messageDisplay == null &&
				browser.mailTabs.getSelectedMessages == null
			) {
				throw new Error("No messagesRead permission");
			}
		}
		return retval;
	};

	return mtwel_msg_selection;
}.call(mtwel_msg_selection || new (function mtwel_msg_selection() {})());
