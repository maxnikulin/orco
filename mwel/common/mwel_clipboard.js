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

var mwel_clipboard = function mwel_clipboard_load() {
	const mwel_clipboard = this;

	/** Copy text to clipboard using copy command and copy event from Editing APIs.
	 * On regular pages setting `document.oncopy` handler
	 * can not overwrite `copy` event listener installed
	 * earlier by the web page. `navigator.clipboard.writeText` is not susceptible
	 * to this problem but it is an asynchronous function, so if it is tried
	 * at first then copy using `copy` event runs out of user action context.
	 *
	 * The method does not work from Firefox add-on background page.
	 *
	 * Unlike `navigator.clipboard.writeText`, command and event approach
	 * works from Chrome extension background page.
	 */
	mwel_clipboard.copyUsingEvent = function copyUsingEvent(text) {
		// A page might install a handler earlier
		let handlerInvoked = false;

		function mwelOnCopy(evt) {
			try {
				evt.stopImmediatePropagation();
				evt.preventDefault();
				evt.clipboardData.clearData();
				evt.clipboardData.setData("text/plain", text);
			} catch (ex) {
				console.error("mwelOnCopy: %o", ex);
			}
			handlerInvoked = true;
		}

		let result;
		try {
			document.addEventListener("copy", mwelOnCopy, true);
			result = document.execCommand("copy");
		} finally {
			document.removeEventListener("copy", mwelOnCopy, true);
		}

		if (!result) {
			console.log("mwel_clipboard: Copy using command and event listener failed");
		} else if (!handlerInvoked) {
			console.log("mwel_clipboard: Page overrides copy handler");
		}
		return result && handlerInvoked;
	};
	return mwel_clipboard;
}.call(mwel_clipboard || new (function mwel_clipboard() {})());
