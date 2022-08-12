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

var mtwel_util = function mtwel_util_load() {
	const mtwel_util = this;

	/** Workaround for Thunderbird-91 `tabs.query({ currentWindow: true })`
	 *
	 * If current window has `messageDisplay` type then tabs from previous
	 * `normal` window is returned. Thunderbird-103 and perhaps 102 do not have
	 * such bug. I have not found relevant issue in the bug tracker.
	 * The following variants return previous window as well:
	 *     browser.windows.getCurrent()
	 *     browser.windows.getLastFocused()
	 *     browser.windows.get(browser.windows.WINDOW_ID_CURRENT)
	 *     browser.tabs.query({ lastFocusedWindow: true })
	 * However from a popup e.g. `windows.getCurrent()` works correctly.
	 */
	mtwel_util.getFocusedWindow = async function getFocusedWindow() {
		try {
			const current = await browser.windows.getCurrent();
			if (current?.focused) {
				return current;
			}
		} catch (ex) {
			console.warn("mtwel_util.getFocusedWindow: windows.getCurrent: ignore exception", ex);
		}
		try {
			const last = await browser.windows.getLastFocused();
			if (last?.focused) {
				return last;
			}
		} catch (ex) {
			console.warn("mtwel_util.getFocusedWindow: windows.getLastFocused: ignore exception", ex);
		}
		try {
			const all = await browser.windows.getAll();
			if (all) {
				for (const win of all) {
					if (win.focused) {
						return win;
					}
				}
			}
		} catch (ex) {
			console.warn("mtwel_util.getFocusedWindow: windows.getAll: ignore exception", ex);
		}
		return undefined;
	};

	/** Workaround for Thunderbird-91 `tabs.query({ currentWindow: true })`
	 *
	 * See `getFocusedWindow` above.
	 */
	mtwel_util.getHighlightedMailTabs = async function getHighlightedMailTabs() {
		// The following does not work from the background page or an action popup:
		//     const currentTab = await browser.tabs.getCurrent();

		const win = await mtwel_util.getFocusedWindow();
		const windowId = win?.id;
		if (windowId == null) {
			return undefined;
		}

		function _filterMailTabs(tabs) {
			if (tabs == null || !(tabs.length > 0)) {
				return undefined;
			}
			tabs = tabs.filter(t => t.type === "messageDisplay" || t.type === "mailTab");
			return tabs.length > 0 ? tabs : undefined;
		}

		try {
			// Thunderbird-91 reports unexpected error for `{ highlighted: true }`:
			// Fix backported to Thunderbird-102.
			// https://bugzilla.mozilla.org/1773977
			// tabs.query({highlighted: true}): Error: An unexpected error occurred undefined
			for (const selector of [ { highlighted: true }, { active: true } ]) {
				try {
					const tabs = _filterMailTabs(
						await browser.tabs.query({ ...selector, windowId }));
					if (tabs !== undefined) {
						return tabs;
					}
				} catch (ex) {
					console.error("mtwel_util.getHighlightedMailTabs: ignore exception", ex);
				}
			}
		} catch (ex) {
			console.warn("mtwel_util.getHighlightedMailTabs: ignore exception", ex);
		}
		return undefined;
	};

	return mtwel_util;
}.call(mtwel_util || new (function mtwel_util() {})());
