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

	// Timeout to discard selection stored for context menu action
	// if popup failed and next time popup opened by direct click on
	// `browserAction` or `messageDisplayAction`.
	get SELECTION_EXPIRE() { return 500; }

	constructor(maxMessages = 4) {
		this.eventSource = new OrcoPubEventSource(this._greet.bind(this));
		this.maxMessages = maxMessages;
	}
	async storeMenusContext(clickData, tab) {
		this._menusContext = await this._getMenusContext(clickData, tab);
		this._menusContext.userAction = true;
	}
	async _getMenusContext(clickData, tab) {
		const schemeRegExp = /^(?:[a-z][a-z0-9]*(?:[-+][a-z0-9]+)*):/i;
		const retval = { ts: Date.now() };
		try {
			if (clickData != null) {
				let selection;
				// Avoid duplicates like `linkUrl === linkText`
				const stored = new Set();
				for (const field of ['linkUrl', 'srcUrl', 'pageUrl', 'frameUrl', 'linkText', 'selectionText']) {
					const value = clickData[field];
					if (value == null || value == "" || stored.has(value)) {
						continue;
					}
					selection = selection || {};
					stored.add(value);
					if (field === 'selectionText') {
						selection[field] = value;
						continue;
					}
					// `pageUrl` is `mailbox:` URL even for RSS articles in 3 pane window
					if (field === 'pageUrl' && value.startsWith('mailbox:')) {
						continue;
					}
					selection.URLs = selection.URLs || [];
					selection.URLs.push({ url: value, source: field });
					// TODO is it reasonable to use real prefix regexp here?
					// TODO move `extractMessageID` from `orco_burl` to a more generic library.
					const midRaw = orco_burl.extractMessageID(schemeRegExp, value);
					const mid = midRaw && 'mid:' + midRaw;
					if (midRaw === undefined || stored.has(mid)) {
						continue;
					}
					stored.add(mid)
					selection.URLs.push({ url: mid, source: field });
				}
				if (selection !== undefined) {
					retval.content = selection;
				}
			}
		} catch (ex) {
			console.error(ex);
			// TODO make error an Array or send to background logger
			retval.error = retval.error || {
				message: String(ex.message || ex),
				type: Object.getPrototypeOf(ex)?.constructor?.name || "Unknown error",
			};
		}
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
			// TODO make error an Array
			retval.error = retval.error || {
				message: String(ex.message || ex),
				type: Object.getPrototypeOf(ex)?.constructor?.name || "Unknown error",
			};
		}
		return retval;
	}
	async _notifySelection() {
		const sentry = this._selectionSentry = {};
		await new Promise(resolve => setTimeout(resolve, this.CONTEXT_MENUS_PAUSE));
		if (this._selectionSentry !== sentry) {
			return;
		}
		let ctx = this._menusContext;
		const now = Date.now();
		if (ctx?.ts < now - this.SELECTION_EXPIRE) {
			console.warn(
				"Discarding stale selection",
				// log fraction of second
				new Date(ctx.ts).toISOString(), new Date(now).toISOString());
			ctx = undefined;
		}
		ctx = ctx ?? await this._getMenusContext(null, null);
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
