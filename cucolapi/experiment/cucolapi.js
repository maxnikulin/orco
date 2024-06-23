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

var { ExtensionSupport } = ChromeUtils.import("resource:///modules/ExtensionSupport.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var con = {
	DEBUG: 0,
	INFO: 1,
	LOG: 2,
	WARN: 3,
	ERROR: 4,
	_level: 2,

	drop() {},
	init(tag, level = 20) {
		this._tag = this._tagValue(tag);
		// implicit reconfigure
		this.level = level;
		return this;
	},
	get tag() {
		return this._tag;
	},
	set tag(tag) {
		this._tag = this._tagValue(tag);
		this._reconfigure();
	},
	get level() {
		return this._level;
	},
	set level(level) {
		const value = (typeof level === "string")
			? this[level.toUpperCase()] : level;
		if (typeof value === "number") {
			this._level = value;
		} else {
			console.warn(`MwelConsole ${this._tag}: incorrect level`, level);
			this._level =this.LOG;
		}
		this._reconfigure();
	},
	_tagValue(tag) {
		if (tag === undefined || tag === null || tag === "") {
			return undefined;
		} else if (typeof tag !== "string") {
			console.warn("MwelConsole: incorrect tag type", tag);
			return undefined;
		}
		return tag;
	},
	_reconfigure() {
		const level = this._level;
		const args = [console];
		const tag = this._tag;
		if (tag !== undefined) {
			args.push(tag);
		}
		for (const name of ['debug', 'info', 'log', 'warn', 'error']) {
			const loggerLevel = this[name.toUpperCase()];
			Object.defineProperty(this, name, {
				value: loggerLevel < level
					? this.drop : console[name].call.bind(console[name], ...args),
				enumerable: true,
				configurable: true,
			});
		}
	},
}.init();

con.init("CuColAPI", "INFO");

con.debug("loading...");

// initialized when `getAPI()` is invoked, allows to avoid hard-coded value
let extensionId;

/** Unlike `ExtensionSupport` calls `onUnloadWindow` for each existing window
 * when `unregisterWindowListener` is invoked. `registerWindowListener`
 * iterates over existing windows for both objects. */
var CuColAPI_Extension = {
	_listeners: new Map(),
	forEachWindow(listenerId, callback) {
		const windowListener = this._listeners.get(listenerId);
		if (!windowListener) {
			throw new Error(`Unknown window listener "${listenerId}"`);
		}
		const errors = [];
		// Alternative specific for `CuColAPI`:
		//    for (let win of Services.wm.getEnumerator("mail:3pane")) {}
		for (const win of ExtensionSupport.openWindows) {
			const windowChromeURL = win.document.location.href;
			if ("chromeURLs" in windowListener &&
				!windowListener.chromeURLs.some(url => url === windowChromeURL)
			) {
				continue;
			}
			try {
				callback(win);
			} catch (ex) {
				con.error("CuColAPI_Extension.forEachWindow: error", ex, win?.location?.href);
				errors.push(ex);
			}
		}
		if (errors.length === 0) {
			return;
		} else if (errors.length === 1) {
			throw errors[0];
		}
		throw new AggregateError(errors, "Exceptions while iterating over windows");
	},
	registerWindowListener(listenerId, windowListener) {
		const retval = ExtensionSupport.registerWindowListener(listenerId, windowListener);
		this._listeners.set(listenerId, windowListener);
		return retval;
	},
	unregisterWindowListener(listenerId, props) {
		const windowListener = this._listeners.get(listenerId);
		if (windowListener === undefined) {
			return false;
		}
		// While `registerWindowListener` iterates over open windows,
		// `unregisterWindowListener` does not do it.
		const existing = !props || !("existing" in props) ? true : props.existing;
		const errors = [];
		if (existing) {
			try {
				this.forEachWindow(
					listenerId,
					function _unregisterWindowListener_call_onUnloadWindow(win) {
						con.debug(
							"CuColAPI_Extension: calling onUnloadWindow",
							win?.location?.href);
						windowListener.onUnloadWindow(win);
					});
			} catch (ex) {
				errors.push(ex);
			}
		}
		let retval;
		try {
			retval = ExtensionSupport.unregisterWindowListener(extensionId);
		} catch (ex) {
			con.error(ex);
			errors.push("CuColAPI_Extension.unregisterWindowListener", ex);
		}
		// FIXME almost certainly conversion to `ExtensionError` is required.
		if (errors.length === 1) {
			throw errors[0];
		} else if (errors.length > 1) {
			throw new AggregateError(errors, "CuColAPI_Extension.unregisterWindowListener failed");
		}
		if (retval) {
			this._listeners.delete(listenerId);
		}
		return retval;
	},
};

// TODO deep equal, optimizing
function mapDifferenceKeys(map1, map2) {
	const keys = new Set([...map1.keys(), ...map2.keys()]);
	const diff = new Set();
	for (const k of keys) {
		if (!Object.is(map1.get(k), map2.get(k))) {
			diff.add(k);
		}
	}
	return diff;
}

// Should be passed to `CuColAPI_Extension` since `ExtensionSupport` does not
// call `onUnloadWindow` in response to `unregisterWindowListener`.
var windowListener = {
	// 3pane windows
	chromeURLs: [
		"chrome://messenger/content/messenger.xul",
		"chrome://messenger/content/messenger.xhtml",
	],
	onLoadWindow: function(win) {
		// Do not log whole `win` since some getters throw exceptions.
		con.debug("windowListener.onLoadWindow", win?.location);
		columnRegistry.addWindowColumns(win);
		try {
			win.FolderDisplayListenerManager.registerListener(columnHandlerInstaller);
		} catch (ex) {
			con.error("FolderDisplayListenerManager.registerListener", ex);
		}
	},
	onUnloadWindow: function(win) {
		con.log("windowListener.onUnloadWindow", win?.location);
		try {
			win.FolderDisplayListenerManager.unregisterListener(columnHandlerInstaller);
		} catch (ex) {
			con.error("FolderDisplayListenerManager.unregisterListener", ex);
		}
		columnRegistry.removeWindowColumns(win);
	},
};

var columnRegistry = {
	_registry: new Map(),
	_extensionIdFallback: "CuColAPI-uninitialized",

	/// Add extension ID to avoid conflicts due to same column name used by different extensions.
	getColumnId(propsId) {
		return (extensionId || this._extensionId) + '-' + propsId;
	},
	addColumnHandlers(dbView) {
		for (const [id, props] of this._registry.entries()) {
			try {
				const fullId = this.getColumnId(id);
				con.debug("addColumnHandler", fullId);
				dbView.addColumnHandler(fullId, props.handler);
			} catch (ex) {
				con.error("columnRegistry.addColumnHandlers", id, ex);
			}
		}
	},
	removeColumnHandlers(dbView, columns) {
		const iter = columns
			? columns.map(props => [ props.id, props ])
			: this._registry.entries();
		for (const [id, props] of iter) {
			// Do not log `dbView`, it causes exception.
			try {
				const fullId = this.getColumnId(id);
				con.debug("removeColumnHandlers", fullId);
				dbView.removeColumnHandler(fullId, props.handler);
			} catch (ex) {
				con.error("columnRegistry.removeColumnHandlers", id, ex);
			}
		}
	},
	addColumn(win, properties) {
		// http://udn.realityripple.com/docs/Mozilla/Thunderbird/Thunderbird_extensions/Creating_a_Custom_Column
		// TODO add splitter?
		const { label, tooltip, imageSrc, fixed, flex } = properties;
		const id = this.getColumnId(properties.id);
		const doc = win.document;
		let treecol = doc.getElementById(id);
		try {
			con.log("addColumn: folderDisplay", id, win.gFolderDisplay?.getColumnStates()?.[id]);
			const attrIter = Services.xulStore.getAttributeEnumerator(doc.URL, id);
			for (const attr of attrIter) {
				const value = Services.xulStore.getValue(doc.URL, id, attr);
				con.log("addColumn: xulStore", id, attr, value);
			}
		} catch (ex) {
			console.error("addColumn: logging persistence", ex);
		}
		if (treecol) {
			con.warn("addColumn: already exists", id, treecol, win);
		} else {
			const attrs = {};
			if (imageSrc) {
				atts.is = "treecol-image";
			}
			treecol = win.document.createXULElement("treecol", attrs);
			treecol.setAttribute("id", id);
			if (attrs.is) {
				treecol.setAttribute("is", attrs.is);
			}
			const persist = ["hidden", "ordinal", "sortDirection"];
			if (flex != null) {
				treecol.setAttribute("flex", flex);
				persist.push("width");
			}
			treecol.setAttribute("persist", persist.join(" "));
			if (fixed) {
				if (flex != null) {
					con.warn('addColumn: both "fixed" and "flex" are specified for', properties.id);
				} else {
					treecol.setAttribute("fixed", "true");
				}
			}
			treecol.setAttribute("closemenu", "none");
			treecol.setAttribute("label", label);
			treecol.setAttribute("tooltiptext", tooltip);
			if (imageSrc) {
				treecol.setAttribute("src", imageSrc);
			}
			try {
				// Unsure if it is necessary, something is restored with no explicit efforts.
				const attrIter = Services.xulStore.getAttributeEnumerator(doc.URL, id);
				for (const attr of attrIter) {
					const value = Services.xulStore.getValue(doc.URL, id, attr);
					treecol.setAttribute(attr, value);
				}
			} catch (ex) {
				con.error("addColumn: error restoring attributes from xulStore", ex);
			}

			// `<treecols>` element
			const threadCols = doc.getElementById("threadCols");
			threadCols.appendChild(treecol);

			con.debug("addColumn: done", id, win?.location);
		}
		try {
			const dbView = win.gDBView;
			if (dbView) {
				con.debug("addColumn: add handler", id);
				const handler = properties.handler;
				dbView.addColumnHandler(id, handler);
			}
		} catch (ex) {
			con.error("addColumn: failed to immediately add handler", id);
		}
	},
	addWindowColumns(win, columns = undefined) {
		con.debug("adding columns to a window", !!columns);
		const iter = columns || this._registry.values();
		for (const props of iter) {
			try {
				this.addColumn(win, props);
			} catch (ex) {
				con.error("addColumn: failed", props?.id, ex, win?.location);
			}
		}
	},

	/// Called from `removeExtensionColumns` or from `windowListener.onUnloadWindow`.
	// In the latter case it may happen on window close or
	// on extension shutdown through another code path in `removeExtensionColumns`.
	removeWindowColumns(win, columnIds = undefined) {
		con.debug("removing columns from a window", !!columnIds);
		const iter = columnIds || this._registry.keys();
		for (const id of iter) {
			let fullId;
			try {
				const dbView = win.gDBView;
				if (dbView) {
					columnRegistry.removeColumnHandlers(dbView, [ this._registry.get(id) ]);
				}
				fullId = this.getColumnId(id);
				const element = win.document.getElementById(fullId);
				if (!element) {
					con.warn("remove window column: not found", fullId);
					continue;
				}
				// TODO check that it is a `treecol`
				con.debug("remove window column", fullId, element);
				element.remove();
			} catch (ex) {
				// FIXME propagate error
				con.error("remove window column failed", fullId || id, ex);
			}
		}
	},
	updateWindowColumns(win, messageIDs) {
		const dbView = win.gDBView;
		if (!dbView) {
			return;
		}
		// TODO check if any column is visible
		for (let i = 0; i < dbView.rowCount; ++i) {
			try {
				const id = dbView.getMsgHdrAt(0)?.messageId;
				if (!messageIDs.has(id)) {
					continue;
				}
				// TODO consider `Ci.nsMsgViewNotificationCode.all`
				// in the case of large changes.
				dbView.NoteChange(i, 1, Ci.nsMsgViewNotificationCode.changed);
			} catch (ex) {
				con.error("updateWindowColumns", ex);
			}
		}
	},

	addExtensionColumns(columnDescriptors, columnDataMap) {
		const idSet = new Set(this._registry.keys());
		const errors = [];
		if (!Array.isArray(columnDescriptors)) {
			columnDescriptors = [ columnDescriptors ];
		}
		const filteredDescriptors = columnDescriptors.filter(function _addExtensionColumns_filter(d) {
			try {
				let id = d?.id;
				if (id == null) {
					throw new TypeError("Column ID is null");
				}
				id = String(id);
				if (id === "") {
					throw new TypeError("Column ID is empty string");
				}
				if (idSet.has(id)) {
					throw new Error(`Column ID "${id}" already exist`);
				}
				idSet.add(id);
				const dataEntries = columnDataMap?.[d.id]
				// TODO functions can not be just passed from background page.
				// Check `menus` implementation.
				// https://hg.mozilla.org/comm-central/file/tip/mail/components/extensions/child/ext-menus.js
				// context.runSafeWithoutClone(callback);
				d.handler = new CuColAPI_ColumnHandler(d, dataEntries && new Map(dataEntries));
				return true;
			} catch (ex) {
				con.error(ex);
				errors.push(ex);
			}
		});
		if (this._registry.size === 0) {
			try {
				for (const descr of filteredDescriptors) {
					this._registry.set(String(descr.id), descr);
				}
				con.debug("register window listener");
				// QNote uses `Services.ww.registerNotification(API.WindowObserver);`
				CuColAPI_Extension.registerWindowListener(extensionId, windowListener);
			} catch (ex) {
				con.error("addExtensionColumns: registerWindowListener", ex);
				errors.push(ex);
				this._registry.clear();
			}
		} else {
			try {
				CuColAPI_Extension.forEachWindow(
					extensionId, win => this.addWindowColumns(win, filteredDescriptors));
			} catch (ex) {
				con.error("add to existing windows", ex);
				errors.push(ex);
			}
			for (const descr of filteredDescriptors) {
				this._registry.set(String(descr.id), descr);
			}
		}
		if (errors.length === 0) {
			return true;
		} if (errors.length === 1) {
			throw errors[0];
		}
		throw new AggregateError(errors, "Failed to remove colunms");
	},

	/** `null` or empty array means remove all.
	 * Removes windows listener if no column remained. */
	removeExtensionColumns(columnDescriptors = undefined) {
		if (!Array.isArray(columnDescriptors)) {
			columnDescriptors = columnDescriptors == null ? [] : [ columnDescriptors ];
		}
		const errors = [];
		const idSet = new Set();
		for (const descriptor of columnDescriptors) {
			let id;
			try {
				id = typeof descriptor === 'string' ? descriptor : descriptor?.id;
				// TODO String(id)
				if (!id || typeof id !== 'string') {
					throw new TypeError("Column ID is not a String");
				}
				if (!this._registry.has(id)) {
					throw new Error(`Unknown column "${id}"`);
				}
				idSet.add(id);
			} catch (ex) {
				con.error("error: remove: building column list", id, ex);
				errors.push(ex);
			}
		}
		if (columnDescriptors.length === 0 || idSet.size === this._registry.size) {
			con.debug("unregister window listener");
			try {
				if (
					!CuColAPI_Extension.unregisterWindowListener(extensionId)
					&& this._registry.size !== 0
				) {
					con.error(
						"Internal error:" +
						" CuColAPI_Extension.unregisterWindowListener:" +
						" listener was not registered");
				}
			} catch (ex) {
				con.error(ex);
				errors.push(ex);
			}
			this._registry.clear();
		} else {
			try {
				CuColAPI_Extension.forEachWindow(
					extensionId, win => this.removeWindowColumns(win, idSet));
			} catch (ex) {
				con.error("remove from existing windows", ex);
				errors.push(ex);
			}
			for (const id of idSet) {
				this._registry.delete(id);
			}
		}
		if (errors.length === 0) {
			return true;
		} if (errors.length === 1) {
			throw errors[0];
		}
		throw new AggregateError(errors, "Failed to remove colunms");
	},
	updateExtensionColumns(columnDataMap) {
		const errors = [];
		const updateMessageIDs = new Set();
		for (const [key, keyValue] of Object.entries(columnDataMap)) {
			try {
				const descriptor = this._registry.get(key);
				if (!descriptor) {
					throw new Error(`Unknown column "${key}"`);
				}
				if (!descriptor.handler.setData) {
					continue;
				}
				for (const id of descriptor.handler.setData(new Map(keyValue))) {
					updateMessageIDs.add(id);
				}
			} catch (ex) {
				con.error("columnRegistry.updateExtensionColumns: data", ex);
				errors.push(ex);
			}
		}
		if (updateMessageIDs.size > 0) {
			try {
				CuColAPI_Extension.forEachWindow(
					extensionId, win => this.updateWindowColumns(win, updateMessageIDs));
			} catch (ex) {
				con.error("columnRegistry.updateExtensionColumns: windows", ex);
				errors.push(ex);
			}
		} else {
			con.debug("nothing to update");
		}
		if (errors.length === 0) {
			return true;
		} if (errors.length === 1) {
			throw errors[0];
		}
		throw new AggregateError(errors, "Failed to update colunms");
	},
};

//
// - TODO: "image" `valueType` (redefine 'isString)
// - TODO: "mixed" as "image"/"text" `valueType`
// - TODO: mapping for sort threads (instance per gDBView)
// - TODO: row or cell properties
// - TODO: `MessageHDR.getTextHeader()` in mapping
// https://searchfox.org/comm-central/source/mozilla/layout/xul/tree/nsITreeView.idl
// https://searchfox.org/comm-central/source/mailnews/base/public/nsIMsgCustomColumnHandler.idl
class CuColAPI_ColumnHandler {
	constructor(props, data) {
		this._data = data || new Map();
		this.getImageSrc = this._getNone;
		this.getText = this._getNone;
		this.getSortStringForRow = this._getNone;
		this._display = props.mapping.display;
		if (this._display == null || typeof this._display !== 'object') {
			throw new TypeError("mapping.display must be an Object");
		}
		switch (props.mapping.valueType) {
			case "text":
				this.getCellText = this._makeGetter(props.mapping, true);
				this.getSortStringForRow = this._makeGetter(props.mapping, false);
				break;
			default:
				throw new Error(`Unknown mapping.valueType "${props.mapping.valueType}a"`);
		}
		// http://udn.realityripple.com/docs/Mozilla/Thunderbird/Thunderbird_extensions/Creating_a_Custom_Column#The_Column_Handler
		// Warning! Do not get confused between `GetCellText()` and
		// `GetSortString/LongForRow()`! Though they sound similar you may not
		// want to return the same value from `both. GetCellText()` is the text
		// that is displayed to the user while `GetSort*ForRow()` is what is used
		// internally when sorting by your column
		//
		// https://searchfox.org/comm-central/source/mailnews/base/public/nsIMsgCustomColumnHandler.idl
		// specifies `long`
		this.getSortLongForRow = this.getSortStringForRow;
	}
	setData(data) {
		const old = this._data;
		this._data = data || new Map();
		return mapDifferenceKeys(old, this._data);
	}
	// `getHdr` `false` is used for sorting.
	_makeGetter(mapping, getHdr) {
		const { field } = mapping;
		const name = "_cucolapi_getter_" + field;
		return {
			[name]: function(rowOrmessageHdr, aTreeColumn) {
				const view = aTreeColumn?.element?.ownerGlobal?.gDBView;
				const messageHdr = getHdr ?
					view?.getMsgHdrAt(rowOrmessageHdr) : rowOrmessageHdr;
				const key = messageHdr && messageHdr[field];
				if (key === undefined) {
					return "";
				}
				let value = this._data.get(key);
				let sub = "";
				// `getSortStringForRow` is called with `msgHdr` argument only,
				// so gDBView is unavailable.
				// TODO create handler instance for each view
				if (
					value === undefined &&
					(view?.viewFlags & Ci.nsMsgViewFlagsType.kThreadedDisplay)
				) {
					const rowIndex = getHdr ?
						rowOrmessageHdr : view.findIndexOfMsgHdr(rowOrmessageHdr, 0, true);
					value = this._getSubthreadValue(rowIndex, view, field);
					if (value !== undefined) {
						// Downwards Arrow with Tip Rightwards
						sub = "\u21b3";
					}
				}
				if (value === undefined) {
					return "";
				}
				return sub + (getHdr ? this._display[value] : value) || "";
			},
		}[name];
	}
	// Mandatory accordingly to `nsIMsgCustomColumnHandler.idl`
	isEditable() {
		return false;
	}
	// Mandatory accordingly to `nsIMsgCustomColumnHandler.idl`
	cycleCell() {
	}
	isString() {
		return true;
	}
	getCellProperties(_rowIndex, _aTreeColumn) {
		return "";
	}
	getRowProperties(_rowIndex) {
		return "";
	}
	_getNone() {
		return "";
	}
	_getFalse() {
		return false;
	}
	_getSubthreadValue(rowIndex, view, field) {
		// see `nsMsgDBView::FetchRowKeywords`
		// https://searchfox.org/comm-central/source/mailnews/base/src/nsMsgDBView.cpp#786
		// No `Ci.ns???` constant.
		// https://searchfox.org/comm-central/source/mailnews/base/src/nsMsgDBView.h#63
		const MSG_VIEW_FLAG_ISTHREAD = 0x8000000;
		const flags = view.getFlagsAt(rowIndex);
		if (
			(flags & MSG_VIEW_FLAG_ISTHREAD) === 0 ||
			(flags & Ci.nsMsgMessageFlags.Elided) === 0
		) {
			return undefined;
		}
		const thread = view.getThreadContainingIndex(rowIndex)
		if (thread === undefined) {
			return undefined
		}
		const numChildren = thread.numChildren;
		// FIXME Should it be 0 or 1?
		for (let index = 0; index < numChildren; index++) {
			const msgHdr = thread.getChildHdrAt(index);
			const key = msgHdr[field];
			if (key === undefined) {
				continue;
			}
			const value = this._data.get(key);
			if (value !== undefined) {
				return value;
			}
		}
	}
};


// Relies on `columnRegistry`
var columnHandlerInstaller = {
	onActiveCreatedView(aFolderDisplay) {
		con.debug("columnHandlerInstaller.onActiveCreatedView",
			aFolderDisplay?.view?.displayedFolder?.name);
		columnRegistry.addColumnHandlers(aFolderDisplay.view.dbView);
	},
	onDestroyingView(aFolderDisplay, _aFolderIsComingBack) {
		con.debug("columnHandlerInstaller.onDestroyingView   ",
			aFolderDisplay?.view?.displayedFolder?.name);
		columnRegistry.removeColumnHandlers(aFolderDisplay.view.dbView);
	},
}

class CuColAPI extends ExtensionCommon.ExtensionAPI {
	getAPI(context) {
		con.debug("getAPI...");
		extensionId = context.extension.id;
		// TODO schema description:
		// https://hg.mozilla.org/comm-central/file/tip/mail/components/extensions/schemas/menus.json
		return {
			cucolapi: {
				add(columnDescriptors, columnDataMap) {
					return columnRegistry.addExtensionColumns(columnDescriptors, columnDataMap);
				},
				remove(columnDescriptors) {
					return columnRegistry.removeExtensionColumns(columnDescriptor);
				},
				updateData(columnDataMap) {
					return columnRegistry.updateExtensionColumns(columnDataMap);
				}
			},
		};
	}

	onShutdown(isAppShutdown, ...other) {
		con.debug("onShutdown. App", isAppShutdown);
		// FIXME unsure if it is necessary, test with normal install
		if (isAppShutdown) {
			return;
		}
		// full-address-column does it in `close()` (needs activation).
		if (extensionId) {
			try {
				columnRegistry.removeExtensionColumns();
			} catch (ex) {
				con.error("onShutdown: error", ex);
			}
		}
	}
}

var cucolapi = CuColAPI;
