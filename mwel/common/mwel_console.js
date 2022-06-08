/*
   Copyright (C) 2020-2022 Max Nikulin

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

class MwelConsole {
	message(logger, format, ...args) {
		const tag = this.tag;
		if (tag === undefined || tag === null || tag === "") {
			logger(format, ...args);
		} else if (typeof format === "string") {
			logger(tag + ": " + format, ...args);
		} else {
			logger(tag, format, ...args);
		}
	}
	drop() {}
	constructor(tag, level = 2) {
		this.tag = tag;
		if (typeof level === "string") {
			level = this[level.toUpperCase()];
		}
		level = level ?? this.LOG;
		this.level = level;
		for (const name of ['debug', 'info', 'log', 'warn', 'error']) {
			const loggerLevel = this[name.toUpperCase()];
			const func = this.message.bind(this, console[name].bind(console));
			Object.defineProperty(this, name, {
				get: () => {
					if (loggerLevel < this.level) {
						return this.drop;
					}
					return func;
				},
				enumerable: true,
			});
		}
	}
}

try {
	for (
		const [level, value]
		of [["DEBUG", 0], ["INFO", 10], ["LOG", 20], ["WARN", 30], ["ERROR", 40]]
	) {
		const prop ={
			enumerable: true,
			writable: false,
			configure: true,
			value,
		};
		Object.defineProperty(MwelConsole, level, prop);
		Object.defineProperty(MwelConsole.prototype, level, prop);
	}
} catch (ex) {
	console.error(ex);
}
