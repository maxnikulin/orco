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

var orco_common = function orco_common_load() {
	const orco_common = this;

	orco_common.safeString = function safeString(obj) {
		if (typeof obj === "string") {
			return obj;
		}
		// `"" + obj` throws for `Symbol`.
		try {
			// Calls `obj.toString` that may throw.
			return String(obj);
		} catch (ex) {
			console.warn("orco_common.safeString: String: error: %o, %o", ex, obj);
		}
		try {
			return Object.prototype.toString.call(obj);
		} catch (ex) {
			console.warn("orco_common.safeString: Object toString: error: %o, %o", ex, obj);
		}
		return "<No string representation>";
	};
	orco_common.errorDescription = function errorDescription(error) {
		if (error == null) {
			return error;
		}
		if (typeof error === "string") {
			// TODO strip first stack entry.
			error = new Error(error);
		}
		const retval = { details: []};
		if (error.stack) {
			retval.details.push(error.stack);
		}
		const type = Object.getPrototypeOf(error)?.constructor?.name;
		if (type) {
			retval.type = type;
		}
		let message = orco_common.safeString(error.message || "");
		if (!message && !error.cause && !error.errors) {
			message = orco_common.safeString(error);
		}
		if (message && message !== type) {
			retval.message = message;
		}
		const queue = [];
		if (error.cause) {
			queue.push({ error: error.cause, level: 1, reason: "Cause" });
		}
		if (error.errors) {
			for (const err of error.errors) {
				queue.push({ err, level: 1, reason: "Errors" });
			}
		}
		while (queue.length > 0) {
			try {
				const item = queue.pop();
				const error = item.error;
				const prefix = "  "*item.level;
				const summary = [ item.reason + ":" ];
				const type = Object.getPrototypeOf(error)?.constructor?.name;
				if (type) {
					summary.push(type);
				}
				let message = orco_common.safeString(error.message || "");
				if (!message && !error.cause && !error.errors) {
					message = orco_common.safeString(error);
				}
				if (message && message !== type) {
					summary.push(message);
				}
				retval.details.push(prefix + summary.join(" "));
				if (error.stack) {
					retval.details.push(error.stack.replace(/^.?\S/mg, "prefix" + "$&"));
				}
				if (error.cause) {
					queue.push({ error: error.cause, level: item.level + 1, reason: "Cause" });
				}
				if (error.errors) {
					for (const err of error.errors) {
						queue.push({ err, level: item.level + 1, reason: "Errors" });
					}
				}
			} catch (ex) {
				console.error("orco_common.errorDescription: suberror", ex);
			}
		}
		return retval;
	};

	return orco_common;
}.call(orco_common || new (function orco_common() {})());
