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

/// Do not allow new task before completion of the current one.
class OrcoSingleTask {
	constructor(getId) {
		if (mwel_common.isFunction(getId)) {
			this.getId = getId;
		} else {
			console.warn("OrcoSingleTask: getId is not a function");
			let id = 0;
			this.getId = () => "st" + id++;
		}
		this._inProgress = 0;
		this.eventSource = new OrcoPubEventSource(this._greet.bind(this));
	}
	/// `params` should be `{ topic, id }`
	run(params, func) {
		if (this._current?.reject) {
			throw new Error("Busy");
		}
		if (this._inProgress > 0) {
			console.warn("OrcoSingleTask.run: %o incomplete tasks", this._inProgress);
		}
		return this._run(params, func);
	}
	async _run(params, func) {
		let current;
		let error;
		try {
			++this._inProgress;
			this._current = current = {
				status: [],
				params: (params == null ? {} : { ...params, }),
			};
			if (current.params.id == null) {
				current.params.id = this.getId();
			}
			this._update(current, { status: "start", running: true });
			const abortPromise = new Promise((_resolve, reject) => current.reject = reject);
			return await func({ abortPromise });
		} catch (ex) {
			error = ex;
			throw ex;
		} finally {
			if (delete current.reject) {
				const status = error !== undefined ? "error" : "finish";
				this._update(current, { status, running: false }, error);
			}
			if (current !== this._current) {
				console.error("OrcoSingleTask: finished task is not the current one", current);
			}
			--this._inProgress;
		}
	}
	abort(ex) {
		const current = this._current;
		if (!current?.reject) {
			throw new Error("No task to abort");
		}
		current.reject(ex);
		delete current.reject;
		this._update(current, { status: "abort", running: false });
	}
	_update(task, params, error) {
		try {
			const status = error !== undefined ? orco_common.errorDescription(error) : {};
			Object.assign(status, params, { ts: Date.now(), });
			task.status.push(status);
			this.eventSource.notify(this._makeMsg(task, status));
			if (error !== undefined) {
				error.ignorePubSub = true;
			}
		} catch (ex) {
			console.error("OrcoSingleTask._update", ex);
		}
	}
	_makeMsg(task, status) {
		const { topic, id } = task.params;
		// TODO Method prefix should be a parameter of eventSource
		return { method: "task.status", params: { topic, ...status }, id };
	}
	*_greet() {
		const task = this._current;
		if (task) {
			for (const status of task.status) {
				yield this._makeMsg(task, status);
			}
		}
	}
}
