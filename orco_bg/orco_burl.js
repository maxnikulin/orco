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

var orco_burl = function orco_burl_load() {
	const orco_burl = this;

	orco_burl.splitPrefixes = function splitPrefixes(text) {
		return text?.split(/(?:\s*,)?\s+/).filter(v => v !== "") ?? [];
	};

	/// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#Escaping
	orco_burl.escapeRegExp = function escapeRegExp(string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	};

	orco_burl.makePrefixRegexp = function makePrefixRegexp(prefixes) {
		return new RegExp("^(?:" + prefixes
			.map(p => p.indexOf(":" >= 0) ? p : p + ":")
			.map(orco_burl.escapeRegExp).join("|") +")");
	};

	orco_burl.addToLinkMap = function addToLinkMap(map, messageId, url) {
		if (messageId === undefined) {
			return undefined;
		}
		if (url === "mid:" + messageId) {
			return messageId;
		}
		let mapValue = map.get(messageId);
		if (
			mapValue !== undefined &&
			(Array.isArray(mapValue) ? mapValue.indexOf(url) >= 0 : url === mapValue)
		) {
			return messageId;
		}
		if (Array.isArray(mapValue)) {
			mapValue.push(url);
		} else {
			let setValue;
			if (mapValue !== undefined) {
				setValue = [ mapValue, url ];
			} else {
				setValue = url;
			}
			map.set(messageId, setValue);
		}
		return messageId;
	};

	orco_burl.linksFromMap = function linksFromMap(map, messageId, prefix) {
		let mapValue = map?.get(messageId);
		if (!Array.isArray(mapValue)) {
			mapValue = mapValue === undefined ? [] : [ mapValue ];
		}
		const retval = [];
		for (const url of mapValue) {
			if (url === true) {
				continue;
			}
			if (!(retval.indexOf(url) >= 0)) {
				retval.push(url);
			}
		}
		for (const p of prefix) {
			const url = p + messageId;
			if (!(retval.indexOf(url) >= 0)) {
				retval.push(url);
			}
		}
		return retval;
	};

	orco_burl.extractMessageID = function extractMessageID(prefixRegExp, url) {
		const components = url.replace(prefixRegExp, "").split('/');
		for (let i = components.length; i-- > 0;) {
			const v = components[i];
			if (v.indexOf('@') >= 0) {
				return v;
			}
		}
	};

	return orco_burl;
}.call(orco_burl || new (function orco_burl() {})());

class OrcoBurlBackendBase {
	// `settings` object should have `backend` and optionally `prefix` fields.
	constructor(settings) {
		this.settings = settings;
	}
	get prefix() {
		return orco_burl.splitPrefixes(this.settings.prefix);
	}
	// `prefix` is an array of links schemes or URL prefixes.
	async getLinkSet(prefix, lock) {
		prefix = prefix ?? this.prefix;
		const regExp = orco_burl.makePrefixRegexp(prefix);
		const urls = await this._doGetLinkSet(prefix, lock);
		if (!urls) {
			throw new Error("No link data received");
		}
		console.debug("orco_burl: %s urls received from backend", urls?.length);
		const map = new Map();
		const set = new Set();
		for (const u of urls) {
			const mid = orco_burl.addToLinkMap(map, orco_burl.extractMessageID(regExp, u), u);
			if (mid !== undefined) {
				set.add(mid);
			}
		}
		console.debug("orco_burl: %o Message-IDs extracted, %o non-mid", set.size, map.size);
		return [ map, set ];
	}
	hello(lock) {
		return this._doHello(lock);
	}
	async visit(params, lock) {
		// { file, lineNo }
		throw new Error("Not implemented");
	}
	async mentions(params, lock) {
		return await this._doMentions(params, lock);
	}
}

OrcoBurlBackendBase.TIMEOUT = 3000;

class OrcoBurlBackend extends OrcoBurlBackendBase {
	async _doGetLinkSet(prefix, lock) {
		const connection = this._connection(lock);
		try {
			const response = await connection.send("burl.linkSet", { prefix });
			return response.urls;
		} finally {
			connection.disconnect();
		}
	}
	async _doHello(lock) {
		const connection = this._connection(lock);
		try {
			return await connection.send("hello");
		} finally {
			connection.disconnect();
		}
	}
	async _doMentions(params, lock) {
		// { variants: [], options: [ countLimit ] }
		const { messageIDs, prefix = this.prefix, map } = params;
		const mentions = [];
		const errors = [];
		const connection = this._connection(lock);
		try {
			for (const mid of messageIDs) {
				try {
					const variants = orco_burl.linksFromMap(map, mid, prefix);
					mentions.push([mid, await connection.send("burl.urlMentions", { variants })]);
				} catch (ex) {
					console.error("OrcoBurlBackend.mentions: error", mid, ex);
					// TODO save in background logger
					errors.push(orco_common.errorDescription(ex));
				}
			}
		} finally {
			connection.disconnect();
		}
		return { mentions, errors };
	}
	async visit(params, lock) {
		const { path, lineNo } = params;
		if (!path) {
			throw new Error("No file path to visit");
		}
		const query = { file: path };
		if (lineNo >= 0) {
			query.lineNo = lineNo;
		}
		const connection = this._connection(lock);
		try {
			await connection.withTimeout(OrcoBurlBackendBase.TIMEOUT).send("burl.visit", query);
		} finally {
			connection.disconnect();
		}
	}
	_connection(lock) {
		const backend = this.settings.backend;
		if (typeof backend !== "string" || backend === "") {
			throw new Error("Backend is not configured");
		}
		const connection = new LrAbortableNativeConnection(backend, lock);
		return connection;
	}
}
