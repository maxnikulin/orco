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

var mwel_common = function() {
	const mwel_common = this;

	mwel_common.has = function has(obj, property) {
		return obj != null && Object.prototype.hasOwnProperty.call(obj, property);
	};

	mwel_common.toString = function toString(obj) {
		return Object.prototype.toString.call(obj);
	};

	const toString = mwel_common.toString;

	// In both cases `typeof func === "function"`
	mwel_common.isFunction = function isFunction(func) {
		return toString(func) === '[object Function]';
	};
	mwel_common.isAsyncFunction = function isAsyncFunction(func) {
		return toString(func) === '[object AsyncFunction]';
	};
	mwel_common.makeGetId = function makeGetId(prefix) {
		let _lastId = 0;
		if (typeof prefix !== "string") {
			prefix = "";
		}
		return function mwelGetId() {
			let id = Date.now();
			if (!(_lastId < id)) {
				id = _lastId + 1;
			}
			_lastId = id;
			return prefix + id;
		}
	};
	return mwel_common;
}.call(mwel_common || new (function mwel_common() {})());
