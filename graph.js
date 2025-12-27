"use strict";

/**
 * A friend node in the graph.
 */
class Node {
	/**
	 * @param {string} name The friend's display name.
	 */
	constructor(name) {
		/** @type {string} */
		this.name = name;
		/** @type {string|null} */
		this.image = null;
		/** @type {{x:number,y:number}} */
		this.pos = vec2(0, 0);
	}
}

/**
 * A small friend graph with force-layout simulation.
 */
class Graph {
	constructor() {
		/** @type {Array<Node|null>} */
		this.nodes = [];
		/** @type {Array<[number, number, Date]>} */
		this.edges = [];
		/** @type {Map<string, number>} */
		this._pairToEdgeIndex = new Map();
		/** @type {Array<Set<number>>} */
		this._adj = [];

		/** @type {number} */
		this.springK = 0.6;
		/** @type {number} */
		this.springRest = 140;
		/** @type {number} */
		this.repelK = 2600;
		/** @type {number} */
		this.closeRepelK = 500;
		/** @type {number} */
		this.centerK = 0.020;

		/** @type {Array<{x:number,y:number}>} */
		this.jitter = [
			vec2(2.5, 0),
			vec2(1.8, 1.8),
			vec2(0, 2.5),
			vec2(-1.8, 1.8),
			vec2(-2.5, 0),
			vec2(-1.8, -1.8),
			vec2(0, -2.5),
			vec2(1.8, -1.8)
		];
	}

	/**
	 * Get an existing node index by name, or create a new one at position (0,0).
	 * @param {string} name Friend name.
	 * @returns {number} Node index.
	 */
	getOrCreateNodeIndex(name) {
		var idx;
		for (idx = 0; idx < this.nodes.length; idx++) {
			var n = this.nodes[idx];
			if (n !== null && n.name === name) return idx;
		}

		for (idx = 0; idx < this.nodes.length; idx++) {
			if (this.nodes[idx] === null) {
				this.nodes[idx] = new Node(name);
				this._adj[idx] = new Set();
				return idx;
			}
		}

		idx = this.nodes.length;
		this.nodes.push(new Node(name));
		this._adj.push(new Set());
		return idx;
	}

	/**
	 * Check whether a node index is currently freed (deleted).
	 * @param {number} i Node index.
	 * @returns {boolean} True if i is in the free list.
	 */
	isFree(i) {
		return this.nodes[i] === null;
	}

	/**
	 * Add a complete friend group: all names become nodes and every pair gets an edge.
	 * If an edge already exists, its stored date becomes the earliest date.
	 * @param {string[]} names Friend names (non-empty).
	 * @param {Date} date Date the connection started.
	 * @returns {void}
	 */
	addFriendGroup(names, date) {
		var indices = [];
		for (var i = 0; i < names.length; i++) {
			indices.push(this.getOrCreateNodeIndex(names[i]));
		}

		for (var a = 0; a < indices.length; a++) {
			for (var b = a + 1; b < indices.length; b++) {
				this.addOrUpdateEdge(indices[a], indices[b], date);
			}
		}
	}

	/**
	 * Get the number of direct connections (degree) of a node.
	 * @param {number} i Node index.
	 * @returns {number} Direct connection count.
	 */
	degree(i) {
		return this._adj[i].size;
	}

	/**
	 * Rename a node. This will create problem if the new name is not unique.
	 * @param {number} i Node index.
	 * @param {string} newName New unique name.
	 * @returns {void}
	 */
	renameNode(i, newName) {
		this.nodes[i].name = newName;
	}

	/**
	 * Advance the force simulation by timestep t.
	 * @param {number} t Timestep in seconds.
	 * @returns {void}
	 */
	update(t) {
		var n = this.nodes.length;
		if (n === 0) return;

		/** @type {Array<{x:number,y:number}>} */
		var forces = new Array(n);
		for (var i = 0; i < n; i++) forces[i] = vec2(0, 0);

		for (var i2 = 0; i2 < n; i2++) {
			if (this.nodes[i2] === null) continue;
			for (var j = i2 + 1; j < n; j++) {
				if (this.nodes[j] === null) continue;
				var pi = this.nodes[i2].pos;
				var pj = this.nodes[j].pos;
				if (vec2.eq(pi, pj)) {
					pj = vec2.add(pj, this.jitter[j & 7]);
				}
				var r = vec2.sub(pj, pi);
				var dist = vec2.len(r);
				var dir = vec2.div(r, dist);
                // Prevents dist to be too low to prevent repelling forces from blowing up
                var dist = Math.max(dist, 1);
				var connected = this._adj[i2].has(j);

				// Long-range forces: spring for connected, repulsion for non-connected.
				if (connected) {
					var stretch = dist - this.springRest;
					var fMag = this.springK * stretch * Math.abs(stretch) / this.springRest;
					var fSpring = vec2.mul(dir, fMag);
					forces[i2] = vec2.add(forces[i2], fSpring);
					forces[j] = vec2.sub(forces[j], fSpring);
				} else {
					var fRepel = this.repelK / (dist * dist);
					var frep = vec2.mul(dir, fRepel);
					forces[i2] = vec2.sub(forces[i2], frep);
					forces[j] = vec2.add(forces[j], frep);
				}

				// Very-strong short-range repulsion for all nodes (decays quickly).
				var fClose = this.closeRepelK / (dist * dist * dist * dist);
				var fcl = vec2.mul(dir, fClose);
				forces[i2] = vec2.sub(forces[i2], fcl);
				forces[j] = vec2.add(forces[j], fcl);
			}
		}

		// Faint pull to center.
		for (var k = 0; k < n; k++) {
			if (this.nodes[k] === null) continue;
			forces[k] = vec2.sub(forces[k], vec2.mul(this.nodes[k].pos, this.centerK));
		}

		var dt = t;
		for (var m = 0; m < n; m++) {
			if (this.nodes[m] === null) continue;
			this.nodes[m].pos = vec2.add(this.nodes[m].pos, vec2.mul(forces[m], dt));
		}
	}

	/**
	 * Add an undirected edge between i and j, or update its stored date to the earliest.
	 * @param {number} i Node index.
	 * @param {number} j Node index.
	 * @param {Date} date Connection date.
	 * @returns {void}
	 */
	addOrUpdateEdge(i, j, date) {
		var a = i < j ? i : j;
		var b = i < j ? j : i;
		var key = a + ":" + b;
		var existing = this._pairToEdgeIndex.get(key);
		if (existing !== undefined) {
			if (date.getTime() < this.edges[existing][2].getTime()) {
				this.edges[existing][2] = date;
			}
			return;
		}

		var idx = this.edges.length;
		this.edges.push([a, b, date]);
		this._pairToEdgeIndex.set(key, idx);
		this._adj[a].add(b);
		this._adj[b].add(a);
	}

	/**
	 * Delete a node without shifting indices; frees the index for reuse.
	 * Removes incident edges and rebuilds internal edge lookup.
	 * @param {number} i Node index.
	 * @returns {Array<[number, number]>} Removed edge endpoint pairs.
	 */
	deleteNode(i) {
		if (this.nodes[i] === null) return [];

		this.nodes[i] = null;
		this._adj[i] = new Set();

		/** @type {Array<[number, number]>} */
		var removedPairs = [];
		/** @type {Array<[number, number, Date]>} */
		var kept = [];
		for (var e = 0; e < this.edges.length; e++) {
			var edge = this.edges[e];
			if (edge[0] === i || edge[1] === i) {
				removedPairs.push([edge[0], edge[1]]);
			} else {
				kept.push(edge);
			}
		}
		this.edges = kept;
		this._rebuildEdgeIndex();
		return removedPairs;
	}

	/**
	 * Recompute internal edge lookup and adjacency from the current edge list.
	 * @returns {void}
	 */
	_rebuildEdgeIndex() {
		this._pairToEdgeIndex = new Map();
		for (var i = 0; i < this._adj.length; i++) {
			this._adj[i] = new Set();
		}
		for (var e = 0; e < this.edges.length; e++) {
			var a = this.edges[e][0];
			var b = this.edges[e][1];
			var key = a + ":" + b;
			this._pairToEdgeIndex.set(key, e);
			this._adj[a].add(b);
			this._adj[b].add(a);
		}
	}
}
