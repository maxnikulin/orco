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

class OrcoMentions {
	// Order of `browser.menus.onClicked` event and creation of the `browserAction` popup
	// is undefined. Wait to avoid race.
	get CONTEXT_MENUS_PAUSE() { return 100; }

	constructor(maxMessages = 4) {
		this.eventSource = new OrcoPubEventSource(this._greet.bind(this));
		this.maxMessages = maxMessages;
	}
	async storeMenusContext(clickData, tab) {
		this._menusContext = await this._getMenusContext(clickData, tab);
		this._menusContext.userAction = true;
	}
	async _getMenusContext(clickData, tab) {
		const retval = { ts: Date.now() };
		try {
			const messages = await mtwel_msg_selection.getMessageHeaderArray(clickData, tab);
			const max = this.maxMessages;
			if (!(messages && messages.length >= 0 && messages.length <= max)) {
				retval.error = {
					message: `Mentions may be shown for 1…${max} messages`,
					type: "Error",
				};
			} else {
				retval.messages = messages.map(h => ({
					messageID: h.headerMessageId,
					from: h.author,
					to: h.recipients?.[0] ??  h.ccList?.[0] ?? h.bccList?.[0],
					date: h.date,
					subject: h.subject,
				}));
			}
		} catch (ex) {
			console.error(ex);
			retval.error = {
				message: String(ex.message || ex),
				type: Object.getPrototypeOf(ex)?.constructor?.name || "Unknown error",
			};
		}
		return retval;
	}
	async _notifySelection() {
		const sentry = this._selectionSentry = {};
		await new Promise(resolve => setTimeout(resolve, this.CONTEXT_MENUS_PAUSE));
		const ctx = this._menusContext ?? await this._getMenusContext(null, null);
		if (this._selectionSentry !== sentry) {
			return;
		}
		delete this._menusContext;
		this.eventSource.notify({ method: "mentions.selection", params: ctx });
	}
	*_greet() {
		this._notifySelection();
	}
}
