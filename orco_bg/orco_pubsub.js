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

// Publish/Subscribe utils

"use strict";

var con = con ?? console;

class OrcoPubEventSource {
	constructor(greet) {
		this._listeners = [];
		this.notify = this._notify.bind(this);
		if (greet) {
			this.greet = greet;
		}
	}
	addListener(callback) {
		this._listeners.unshift(callback);
	}
	removeListener(callback) {
		const index = this._listeners.indexOf(callback);
		if (!(index >= 0)) {
			con.warn("OrcoPubEventSource: no listener to remove", callback);
			return;
		}
		this._listeners.splice(index, 1);
		return true;
	}
	_notify(arg) {
		for (const callback of this._listeners) {
			try {
				callback(arg);
			} catch (ex) {
				con.error("OrcoPubEventSource.notify: %o %o", ex, callback);
			}
		}
	}
}

class OrcoCombinedPubEventSource extends OrcoPubEventSource {
	constructor(sources) {
		super();
		this.sources = [];
		this.addSource = this._addSource.bind(this);
		for (const src of sources ?? []) {
			this.addSource(src);
		}
	}
	*greet() {
		for (const src of this.sources) {
			try {
				if (src.greet) {
					yield *src.greet();
				}
			} catch (ex) {
				// to be handled by `window.onerror`
				Promise.reject(ex);
			}
		}
	}
	_addSource(src) {
		src.addListener(this.notify);
		this.sources.push(src);
	}
}

class _OrcoPub {
	constructor(messageHandler) {
		this.messageHandler = messageHandler;
		this._subscribers = [];
		const boundMethods = ["onMessage", "postMessage", "onDisconnect" ];
		for (const method of boundMethods) {
			this[method] = this["_" + method].bind(this);
		}
		this.eventSource = new OrcoCombinedPubEventSource();
		this.eventSource.addListener(this.postMessage);
	}
	get addSource() { return this.eventSource.addSource; }
	_postMessage(message) {
		if (message == null) {
			return;
		}
		for (const subscriber of this._subscribers) {
			try {
				subscriber.postMessage(message);
			} catch (ex) {
				con.error("OrcoPubSubService: failed to post message: %o, %o", subscriber, message);
			}
		}
	}
	shutdown() {
		con.debug("OrcoPubSubService: publisher shutdown");
		for (const subscriber of this._subscribers) {
			try {
				con.debug("OrcoPubSubService: disconnecting due to shutdown: %o", subscriber);
				subscriber.disconnect();
			} catch (ex) {
				con.error("OrcoPubSubService: disconnect failed: %o", subscriber);
			}
		}
		this._subscribers.splice(0);
	}
	onConnect(port) {
		con.debug("OrcoPubSubService: subscribing", port);
		port.onDisconnect.addListener(this.onDisconnect);
		port.onMessage.addListener(this.onMessage);
		this._subscribers.push(port);
		for (const message of this.eventSource.greet?.() ?? []) {
			port.postMessage(message);
		}
	}
	_onDisconnect(port) {
		con.debug("OrcoPubSubService: unsubscribing disconnected from publisher", port);
		const index = this._subscribers.indexOf(port);
		if (index >= 0) {
			this._subscribers.splice(index, 1);
		} else {
			con.warn("OrcoPubSubService: not subscribed to publisher", port);
		}
		port.onDisconnect.removeListener(this.onDisconnect);
		port.onMessage.removeListener(this.onMessage);
	}
	_onMessage(message, port) {
		const result = this.messageHandler.onMessage(message, port);
		if (result.then) {
			// TODO report to background log ring that should issue an error notification
			result.catch(ex => this._onError(ex, message)).then(this.postMessage);
		}
	}
	_onError(ex, request) {
		con.error("OrcoPubSubService: onMessage error", ex);
		const message = {
			method: "error",
			params: orco_common.errorDescription(ex),
		};
		const id = request?.id;
		if (id != null) {
			message.id = id;
		}
		return message;
	}
}

class OrcoPubSubService {
	constructor() {
		this._publishers = new Map();
		const boundMethods = ["onConnect", "onMessage", "onIgnoredMessage", "onDisconnect"];
		for (const method of boundMethods) {
			this[method] = this["_" + method].bind(this);
		}
	}
	/// Returns `addSource` function
	register(name, messageHandler) {
		const existing = this._publishers.get(name);
		if (existing) {
			con.warn(
				"OrcoPubSubService: overriding publisher %o from %o to %o",
				name, existing.publisher, publisher);
			existing.shutdown();
		}
		const entry = new _OrcoPub(messageHandler);
		this._publishers.set(name, entry);
		return entry.addSource;
	}
	_onConnect(port) {
		con.debug("OrcoPubSubService: connected", port);
		if (!(this._publishers.size > 0)) {
			con.warn("OrcoPubSubService: no publisher registered so far");
		}
		port.onMessage.addListener(this.onMessage);
		port.onDisconnect.addListener(this.onDisconnect);
	}
	_onMessage(request, port) {
		const subscription = request?.params;
		const publisher = this._publishers.get(subscription);
		try {
			if (request?.method === "subscribe" && publisher) {
				con.debug("OrcoPubSubService: passing subscriber to %o", subscription);
				publisher.onConnect(port);
				const rv = port.onMessage.removeListener(this.onMessage);
				port.onDisconnect.removeListener(this.onDisconnect);
				return;
			}
		} catch (ex) {
			con.error("OrcoPubSubService: publisher failed: %o: %o from %o", subscription, ex, port);
		}
		con.log("OrcoPubSubService: ignoring further %o messages for %o", request, port);
		port.onMessage.addListener(this.onIgnoredMessage);
		// TODO consider handling later subscribe/unsubscribe requests
		port.onMessage.removeListener(this.onMessage);
	}
	_onIgnoredMessage(request, port) {
		con.warn("OrcoPubSubService: ignoring invalid subscription message", request, port);
	}
	_onDisconnect(port) {
		con.debug("OrcoPubSubService: disconnected without subscription", port);
		port.onMessage.removeListener(this.onMessage);
		port.onMessage.removeListener(this.onIgnoredMessage);
		port.onDisconnect.removeListener(this.onDisconnect);
	}
}

class OrcoSubscriptionHandler {
	constructor(allowedId) {
		this._methods = new Map();
		this.onMessage = this._onMessage.bind(this);
		this._allowedId = allowedId;
	}
	register(prefix, object) {
		for (const [name, method] of Object.entries(object)) {
			if (name.startsWith("_")) {
				continue;
			}
			const fullName = prefix + "." + name;
			if (this._methods.has(fullName)) {
				con.warning("OrcoSubscriptionHandler: overriding %o method", fullName);
			}
			this._methods.set(fullName, method.bind(object));
		}
	}
	async _onMessage(request, port) {
		// Exceptions are handled by OrcoPubSubService
		if (this._allowedId !== undefined && port?.sender?.id !== this._allowedId) {
			// Likely redundant check since `runtime.onExternalMessage` listener
			// should be explicitly added to receive messages from other extensions.
			throw new Error(`Foreign message rejected from "${port?.id}"`);
		}
		const method = request?.method;
		const func = this._methods.get(method);
		if (!func) {
			throw new Error(`Unknown method "${method}"`);
		}
		return await func(request, port);
	}
}
