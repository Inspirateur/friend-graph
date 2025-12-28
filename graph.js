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
		/** @type {number} */
		this.repelK = 1000000;
		/** @type {number} */
		this.attractK = 0.01;
		/** @type {number} */
		this.centerK = 1.0;

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
				return idx;
			}
		}

		idx = this.nodes.length;
		this.nodes.push(new Node(name));
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
		if (this.nodes[i] === null) return 0;
		var d = 0;
		for (var e = 0; e < this.edges.length; e++) {
			var edge = this.edges[e];
			if (edge[0] === i || edge[1] === i) d++;
		}
		return d;
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

		// Node repulsion: applies to all pairs.
		for (var i = 0; i < n; i++) {
			if (this.nodes[i] === null) continue;
			for (var j = i + 1; j < n; j++) {
				if (this.nodes[j] === null) continue;
				var pi = this.nodes[i].pos;
				var pj = this.nodes[j].pos;
				// Add a small jitter to avoid zero length vectors.
				if (vec2.eq(pi, pj)) {
					pj = vec2.add(pj, this.jitter[j & 7]);
				}
				var f = this.nodeRepulsionForce(pi, pj);
				forces[i] = vec2.sub(forces[i], f);
				forces[j] = vec2.add(forces[j], f);
			}
		}

		// Edge attraction: only for connected pairs, iterating edges (no adjacency map needed).
		for (const edge of this.edges) {
			var i = edge[0];
			var j = edge[1];
			if (this.nodes[i] === null || this.nodes[j] === null) continue;
			var pi = this.nodes[i].pos;
			var pj = this.nodes[j].pos;
			var edgeForce = this.edgeAttractionForce(pi, pj);
			forces[i] = vec2.add(forces[i], edgeForce);
			forces[j] = vec2.sub(forces[j], edgeForce);
		}

		// Faint pull to center.
		for (var i = 0; i < n; i++) {
			if (this.nodes[i] === null) continue;
			forces[i] = vec2.sub(forces[i], vec2.mul(this.nodes[i].pos, this.centerK));
		}

		for (var i = 0; i < n; i++) {
			if (this.nodes[i] === null) continue;
			this.nodes[i].pos = vec2.add(this.nodes[i].pos, vec2.mul(forces[i], t));
		}
	}

	/**
	 * Compute the attraction force between two nodes connected by an edge.
	 * @param {{x:number,y:number}} posA Position of node A.
	 * @param {{x:number,y:number}} posB Position of node B.
	 * @returns {{x:number,y:number}} Attraction force vector applied to A. (B gets the opposite.)
	 */
	edgeAttractionForce(posA, posB) {
		var delta = vec2.sub(posB, posA);
		var deltaSq = vec2.pow(delta, 2);
		return vec2.mul(deltaSq, this.attractK);
	}

	/**
	 * Compute the repulsion force between two nodes.
	 * @param {{x:number,y:number}} posA Position of node A. Guaranteed different from B.
	 * @param {{x:number,y:number}} posB Position of node B. Guaranteed different from A.
	 * @returns {{x:number,y:number}} Repulsion force vector applied to A. (B gets the opposite.)
	 */
	nodeRepulsionForce(posA, posB) {
		var delta = vec2.sub(posB, posA);
		var dist = vec2.len(delta);
		var dir = vec2.div(delta, dist);
		var fMag = this.repelK / (dist * dist);
		// Cap the force magnitude to avoid extreme values at short distances.
		return vec2.mul(dir, Math.min(fMag, 100));
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

		var existing = -1;
		for (var e = 0; e < this.edges.length; e++) {
			var edge = this.edges[e];
			if (edge[0] === a && edge[1] === b) {
				existing = e;
				break;
			}
		}
		if (existing !== -1) {
			if (date.getTime() < this.edges[existing][2].getTime()) {
				this.edges[existing][2] = date;
			}
			return;
		}

		this.edges.push([a, b, date]);
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
		return removedPairs;
	}
}
