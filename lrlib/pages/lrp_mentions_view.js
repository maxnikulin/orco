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

var lrp_mentions_view = function lrp_mentions_view_load() {
	const lrp_mentions_view = this;

	lrp_mentions_view.render = function render(mentions) {
		function _getLineNoWidth(tree) {
			const queue = [];
			let lineNo = 1;
			try {
				if (tree != null) {
					queue.push(tree);
				}
				while (queue.length > 0) {
					const item = queue.pop();
					// Math.max may return NaN
					if (item.lineNo > lineNo) {
						lineNo = item.lineNo;
					}
					const children = item.children || item.links;
					if (Array.isArray(children)) {
						queue.push(...children);
					}
				}
			} catch (ex) {
				console.error("LrMentionsResult._maxLineNo: error: %o", ex);
			}
			return 1 + Math.floor(Math.log10(lineNo));
		}

		const fragment = new DocumentFragment();
		const queue = [];
		queue.push({ item: mentions });
		const stack = [ { node: fragment } ];
		const canVisit = true; /* props && props.onclick &&
			props.hello && props.hello.capabilities &&
			(props.hello.capabilities.indexOf("visit") >= 0); */ // FIXME
		const captionAttrs = canVisit ? { role: "button", tabindex: 0 } : null
		const lineNoWidth = _getLineNoWidth(mentions);
		let fileDepth = null;
		let path = null;
		while (queue.length > 0) {
			const { item, post } = queue.pop();
			if (post) {
				if (item._type !== "Body") {
					stack.pop();
				}
				if (item._type === "File") {
					fileDepth = null;
					path = null;
				}
				continue;
			}

			const caption = [];

			if (item._type === "File") {
				fileDepth = stack.length;
				path = path || item.path;
			}

			if (item.lineNo > 0) {
				const num = item.lineNo.toString(10);
				caption.push(
					E('span', { className: "lineNoPad" }, "".padStart(lineNoWidth - num.length)),
					E('span', { className: "lineNo" }, num),
					E('span', { className: "lineNoPad" }, ":".padEnd(stack.length - fileDepth, "·")),
				);
			}

			if ((item.lineNo > 0 || stack.length > fileDepth) && item._type === "Link") {
				caption.push(E('span', { className: "lineNoPad" }, " "))
			}
			const title = item.title || item.rawText || item.path;
			if (title) {
				if (item._type === "Heading") {
					caption.push(
						E('span', { className: "lineNoPad" }, "* "),
						E('span', { className: "heading" }, title),
					);
				} else {
					caption.push((item._type || "Link") + ": ");
					const attr = item._type === "Tab" ? { className: "heading" } :
						(path ? { className: "mentionTitle" } : null);
					caption.push(E('span', attr, title));
				}
			} else if (item.descr || item.url) {
				caption.push(item._type || "Link", ": ");
				const attr = path ? { className: "mentionTitle" } : null;
				if (item.descr) {
					caption.push(E('span', attr, item.descr));
				}
				if (item.url) {
					if (item.descr) {
						caption.push(" ");
					}
					caption.push(E('span', attr, item.url));
				}
			}
			if (item.total > 1) {
				let text;
				if (caption.length > 0) {
					if (item.total > item.filtered) {
						text = `(${item.filtered}/${item.total})`;
					} else {
						text = `(${item.total})`;
					}
				} else {
					if (item.total > item.filtered) {
						text = `${item.filtered} of ${item.total} links`;
					} else {
						text = `${item.total} links`;
					}
				}
				caption.push(" ", E('span', null, text));
			}
			const { node } = stack[stack.length - 1];
			const children = item.children || item.links;
			const attrs = path ? captionAttrs : null;
			const captionElement = E('span', attrs, ...caption);
			if (path) {
				captionElement.dataset.orcoPath = path;
				captionElement.dataset.orcoAction = "visit";
			}
			if (item.lineNo > 0) {
				captionElement.dataset.orcoLineNo = item.lineNo;
			}
			const elements = item._type === "Body" ? [] : [ captionElement ];
			if (children) {
				queue.push({ item, post: true });
				queue.push(...children.slice().reverse().map(it => ({item: it})));
				if (item._type !== "Body") {
					const ul = E('ul');
					elements.push(ul);
					stack.push({ node: ul });
				}
			}
			if (elements.length > 0) {
				node.append(E('li', null, ...elements));
			}
		}
		return fragment;
	};
	return lrp_mentions_view;
}.call(lrp_mentions_view || new (function lrp_mentions_view() {})());
