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
	notifySelfClick(clickData) {
		const selfURL = browser.runtime.getURL("/");
		const fields = ['linkUrl', 'srcUrl', 'frameUrl'];
		if (
			clickData == null
			|| !clickData.pageUrl?.startsWith(selfURL)
			|| !fields.every(f => { const v = clickData[f]; return !v || v.startsWith(selfURL); })
		) {
			return false;
		}
		this.eventSource.notify({
			method: "orco.log",
			params: { message: "Context menu action ignored: no URL", },
		});
		return true;
	}
	async storeMenusContext(clickData, tab) {
		this._menusContext = await this._getMenusContext(clickData, tab);
		this._menusContext.userAction = true;
	}
	async _getMenusContext(clickData, tab) {
		const schemeRegExp = /^(?:[a-z][a-z0-9]*(?:[-+][a-z0-9]+)*):(?:\/\/)?/i;
		const selfURL = browser.runtime.getURL("/");
		// `pageUrl` is `mailbox:` URL even for RSS articles in 3 pane window,
		// `news` is internal URI with `?group=...` parameters.
		const ignorePagePrefixes = [ "mailbox:", "news:" ];
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
					if (field === 'selectionText' || field === 'linkText') {
						if (selection === undefined) {
							// no URLs
							break;
						}
						stored.add(value);
						selection[field] = value;
						continue;
					}
					if (value.startsWith(selfURL)) {
						continue;
					}
					if (field === 'pageUrl' && ignorePagePrefixes.some(p => value.startsWith(p))) {
						continue;
					}
					selection = selection || {};
					selection.URLs = selection.URLs || [];
					selection.URLs.push({ url: value, source: field });
					stored.add(value);
					// Mozilla recognizes implicit links like www.google.com
					// and email addresses that are rather similar to Message-IDs.
					// `linkText` unlike `linkURL` in such cases has no scheme
					// and maybe lack of trailing slash.
					const withoutScheme = value.replace(schemeRegExp, "");
					stored.add(withoutScheme);
					stored.add(withoutScheme.replace(/\/+$/, ""));
					// TODO is it reasonable to use real prefix regexp here?
					// TODO move `extractMessageID` from `orco_burl` to a more generic library.
					// Adding mailto: links as duplicate with mid: is considered as acceptable.
					const midRaw = orco_burl.extractMessageID(schemeRegExp, value);
					const mid = midRaw && 'mid:' + midRaw;
					if (midRaw === undefined) {
						continue;
					}
					if (stored.has(mid)) {
						if (value === mid) {
							selection.URLs.pop();
						} else {
							continue;
						}
					}
					let messages;
					try {
						messages = await this._queryMessageId(midRaw);
						if (messages?.length > 0 && value.startsWith("mailto:" + midRaw)) {
							selection.URLs.pop();
						}
					} catch (ex) {
						console.error(ex);
					}
					stored.add(mid);
					stored.add(midRaw);
					selection.URLs.push({
						url: mid,
						source: field,
						messages: messages && messages.map(this._convertMessage).slice(0, 5),
					});
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
			const clickInPopup = clickData?.pageUrl?.startsWith(selfURL);
			const messages = !clickInPopup
				&& await mtwel_msg_selection.getMessageHeaderArray(clickData, tab);
			const max = this.maxMessages;
			if (messages && !(messages.length >= 0 && messages.length <= max)) {
				retval.error = {
					message: `Mentions may be shown for 1…${max} messages`,
					type: "Error",
				};
			} else if (messages) {
				// `this` is not used by the method.
				retval.messages = messages.map(this._convertMessage);
			}
		} catch (ex) {
			console.error(ex);
			// TODO make error an Array
			retval.error = retval.error || orco_common.errorDescription(ex) || {
				message: String(ex.message || ex),
				type: Object.getPrototypeOf(ex)?.constructor?.name || "Unknown error",
			};
		}
		return retval;
	}

	async _queryMessageId(headerMessageId) {
		const result = await browser.messages.query({ headerMessageId });
		return result?.messages?.length > 0 ? result.messages : undefined;
	}

	_convertMessage(header /* messages.MessageHeader */) {
		// TODO consider adding `accountsRead` permission to use folder
		// name (it can not be changed) as newsgroup name for NNTP accounts
		// since other fields are empty.
		function* _recipients(h) {
			let i = 0;
			const limit = 5;
			for (const value of [h.recipients, h.ccList, h.bccList]) {
				if (!value) {
					continue;
				}
				for (const addr of value) {
					if (++i > limit) {
						break;
					}
					yield addr
				}
			}
		}
		const converted = {
			messageID: header.headerMessageId,
			from: header.author,
			subject: header.subject,
		};
		const to = Array.from(_recipients(header));
		if (to.length > 0) {
			converted.to = to;
		}
		const { date } = header;
		// Caught `Invalid Date` on a development Thunderbird version,
		// should be rare in real life. Unsure if mail servers interpret the header though.
		if (date && date instanceof Date && !isNaN(date)) {
			converted.date = date;
		}
		
		return converted;
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
