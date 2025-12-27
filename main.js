"use strict";

/**
 * @param {string} s Year string like "2020".
 * @returns {Date} Date for Jan 1st of that year.
 */
function parseYearInput(s) {
	var y = parseInt(s, 10);
	return new Date(y, 0, 1);
}

/**
 * @param {Date} d Connection date.
 * @param {Date} now Current date.
 * @returns {string} CSS color string for the edge.
 */
function edgeColor(d, now) {
	var ageYears = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
	var hue = 120 - Math.min(10, Math.max(0, ageYears)) * 12;
	return "hsl(" + hue + " 75% 45%)";
}

/**
 * @param {SVGElement} svg The graph SVG.
 * @returns {{w:number,h:number}} Size in pixels.
 */
function svgSize(svg) {
	var r = svg.getBoundingClientRect();
	return { w: r.width, h: r.height };
}

/**
 * Ensure the SVG viewBox is centered at (0,0).
 * @param {SVGSVGElement} svg The SVG element.
 * @returns {void}
 */
function updateViewBox(svg) {
	var s = svgSize(svg);
	svg.setAttribute("viewBox", (-s.w / 2) + " " + (-s.h / 2) + " " + s.w + " " + s.h);
}

/**
 * Convert a client (screen) position to SVG coordinates.
 * @param {SVGSVGElement} svg Root SVG.
 * @param {number} clientX Client X.
 * @param {number} clientY Client Y.
 * @returns {{x:number,y:number}} SVG point.
 */
function clientToSvg(svg, clientX, clientY) {
	var pt = new DOMPoint(clientX, clientY);
	var ctm = svg.getScreenCTM();
	var inv = ctm.inverse();
	var p = pt.matrixTransform(inv);
	return vec2(p.x, p.y);
}

/**
 * @param {string} tag SVG tag name.
 * @returns {SVGElement} Created SVG element.
 */
function svgEl(tag) {
	return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

/**
 * Set the href on an SVG <image> element in a cross-browser way.
 * @param {SVGImageElement} img The SVG image element.
 * @param {string} href Data URL or URL.
 * @returns {void}
 */
function setSvgImageHref(img, href) {
	img.setAttribute("href", href);
	img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
}

/**
 * @param {HTMLInputElement} input File input element.
 * @param {number} maxSize Maximum width/height in pixels.
 * @returns {Promise<string>} Resolves to a small data URL.
 */
function readAndResizeImage(input, maxSize) {
	return new Promise(function(resolve) {
		var file = input.files[0];
		var reader = new FileReader();
		reader.onload = function() {
			var img = new Image();
			img.onload = function() {
				var w = img.naturalWidth;
				var h = img.naturalHeight;
				var s = Math.min(1, maxSize / Math.max(w, h));
				var cw = Math.max(1, Math.round(w * s));
				var ch = Math.max(1, Math.round(h * s));
				var canvas = document.createElement("canvas");
				canvas.width = cw;
				canvas.height = ch;
				var ctx = canvas.getContext("2d");
				ctx.drawImage(img, 0, 0, cw, ch);
				resolve(canvas.toDataURL("image/jpeg", 0.85));
			};
			img.src = /** @type {string} */(reader.result);
		};
		reader.readAsDataURL(file);
	});
}

/**
 * Create one node input.
 * @param {HTMLElement} host Container for inputs.
 * @returns {HTMLInputElement} The created input element.
 */
function createNameInput(host) {
	var input = document.createElement("input");
	input.type = "text";
	input.placeholder = "Friend name";
	input.setAttribute("list", "friendNames");
	host.appendChild(input);
	return input;
}

/**
 * Refresh the datalist options from existing graph node names.
 * @param {Graph} graph Data model.
 * @param {HTMLDataListElement} datalist Datalist backing autocomplete.
 * @returns {void}
 */
function syncFriendDatalist(graph, datalist) {
	datalist.innerHTML = "";
	for (var i = 0; i < graph.nodes.length; i++) {
		if (graph.isFree(i)) continue;
		var opt = document.createElement("option");
		opt.value = graph.nodes[i].name;
		datalist.appendChild(opt);
	}
}

/**
 * @param {number} a Node index.
 * @param {number} b Node index.
 * @returns {string} SVG edge id.
 */
function edgeId(a, b) {
	var x = a < b ? a : b;
	var y = a < b ? b : a;
	return "edge-" + x + ":" + y;
}

/**
 * Keep N dynamic: when the text input before the last is filled, append one.
 * @param {HTMLElement} host Container with text inputs.
 * @returns {void}
 */
function ensureTrailingBlank(host) {
	var inputs = host.querySelectorAll('input[type="text"]');
	if (inputs.length < 2) return;
	var beforeLast = inputs[inputs.length - 2];
	var last = inputs[inputs.length - 1];
	if (beforeLast.value.trim().length > 0 && last.value.trim().length > 0) {
		createNameInput(host);
		return;
	}
	if (beforeLast.value.trim().length > 0 && last.value.trim().length === 0) {
		createNameInput(host);
	}
}

/**
 * Reset the name input area back to N=2 inputs.
 * @param {HTMLElement} host Container with text inputs.
 * @returns {void}
 */
function resetNameInputs(host) {
	host.innerHTML = "";
	createNameInput(host);
	createNameInput(host);
}

/**
 * Collect non-empty friend names from inputs.
 * @param {HTMLElement} host Container with text inputs.
 * @returns {string[]} Names.
 */
function collectNames(host) {
	var inputs = host.querySelectorAll('input[type="text"]');
	var names = [];
	for (var i = 0; i < inputs.length; i++) {
		var v = inputs[i].value.trim();
		if (v.length > 0) names.push(v);
	}
	return names;
}

/**
 * Create missing SVG elements for nodes/edges and update existing ones.
 * @param {Graph} graph Data model.
 * @param {SVGSVGElement} svg Root svg.
 * @param {SVGDefsElement} defs SVG defs for clip paths.
 * @param {SVGGElement} edgesG Edge group.
 * @param {SVGGElement} nodesG Node group.
 * @param {number} selectedIndex Selected node index.
 * @param {(idx:number, ev:PointerEvent)=>void} onNodePointerDown Node pointerdown callback.
 * @returns {void}
 */
function syncSvg(graph, svg, defs, edgesG, nodesG, selectedIndex, onNodePointerDown) {
	var now = new Date();

	for (const edge of graph.edges) {
		var id = edgeId(edge[0], edge[1]);
		/** @type {SVGLineElement} */
		var line = /** @type {SVGLineElement} */(document.getElementById(id));
		if (!line) {
			line = /** @type {SVGLineElement} */(svgEl("line"));
			line.id = id;
			line.classList.add("edge");
			edgesG.appendChild(line);
		}
		var a = graph.nodes[edge[0]].pos;
		var b = graph.nodes[edge[1]].pos;
		line.setAttribute("x1", a.x);
		line.setAttribute("y1", a.y);
		line.setAttribute("x2", b.x);
		line.setAttribute("y2", b.y);
		line.setAttribute("stroke", edgeColor(edge[2], now));
	}

	for (var i = 0; i < graph.nodes.length; i++) {
		if (graph.isFree(i)) continue;
		var nid = "node" + i;
		/** @type {SVGGElement} */
		var g = /** @type {SVGGElement} */(document.getElementById(nid));
		if (!g) {
			g = /** @type {SVGGElement} */(svgEl("g"));
			g.id = nid;
			g.classList.add("node");
			g.setAttribute("data-idx", String(i));
			g.addEventListener("pointerdown", function(ev) {
				var idx = parseInt(this.getAttribute("data-idx"), 10);
				onNodePointerDown(idx, ev);
			});

			var clipId = "clip" + i;
			var clip = /** @type {SVGClipPathElement} */(document.getElementById(clipId));
			if (!clip) {
				clip = /** @type {SVGClipPathElement} */(svgEl("clipPath"));
				clip.id = clipId;
				var cc = svgEl("circle");
				cc.setAttribute("r", "22");
				cc.setAttribute("cx", "0");
				cc.setAttribute("cy", "0");
				clip.appendChild(cc);
				defs.appendChild(clip);
			}

			var img = /** @type {SVGImageElement} */(svgEl("image"));
			img.setAttribute("x", "-22");
			img.setAttribute("y", "-22");
			img.setAttribute("width", "44");
			img.setAttribute("height", "44");
			img.setAttribute("preserveAspectRatio", "xMidYMid slice");
			img.setAttribute("clip-path", "url(#" + clipId + ")");

			var bg = svgEl("circle");
			bg.classList.add("bg");
			bg.setAttribute("r", "22");
			bg.setAttribute("cx", "0");
			bg.setAttribute("cy", "0");

			var outline = svgEl("circle");
			outline.classList.add("outline");
			outline.setAttribute("r", "22");
			outline.setAttribute("cx", "0");
			outline.setAttribute("cy", "0");

			var t = svgEl("text");
			t.setAttribute("x", "0");
			t.setAttribute("y", "38");
			t.setAttribute("text-anchor", "middle");
			t.textContent = graph.nodes[i].name;

			g.appendChild(bg);
			g.appendChild(img);
			g.appendChild(outline);
			g.appendChild(t);
			nodesG.appendChild(g);
		}

		g.setAttribute("data-idx", String(i));
		if (i === selectedIndex) g.classList.add("selected");
		else g.classList.remove("selected");

		var p = graph.nodes[i].pos;
		g.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
		var label = /** @type {SVGTextElement} */(g.querySelector("text"));
		label.textContent = graph.nodes[i].name;

		var nodeImg = /** @type {SVGImageElement} */(g.querySelector("image"));
		if (graph.nodes[i].image) {
			setSvgImageHref(nodeImg, graph.nodes[i].image);
			nodeImg.style.display = "block";
		} else {
			nodeImg.removeAttribute("href");
			nodeImg.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
			nodeImg.style.display = "none";
		}
	}
}

/**
 * Main entry: wires inputs and starts the simulation/render loop.
 * @returns {void}
 */
function main() {
	/** @type {Graph} */
	var graph = new Graph();
	var svg = /** @type {SVGSVGElement} */(document.getElementById("graph"));
	var defs = /** @type {SVGDefsElement} */(document.getElementById("defs"));
	var edgesG = /** @type {SVGGElement} */(document.getElementById("edges"));
	var nodesG = /** @type {SVGGElement} */(document.getElementById("nodes"));
	var namesHost = /** @type {HTMLElement} */(document.getElementById("names"));
	var datalist = /** @type {HTMLDataListElement} */(document.getElementById("friendNames"));
	var yearInput = /** @type {HTMLInputElement} */(document.getElementById("year"));
	var addBtn = /** @type {HTMLButtonElement} */(document.getElementById("add"));
	var panelName = /** @type {HTMLElement} */(document.getElementById("panelName"));
	var panel = /** @type {HTMLElement} */(document.getElementById("panel"));
	var panelImg = /** @type {HTMLImageElement} */(document.getElementById("panelImg"));
	var panelFile = /** @type {HTMLInputElement} */(document.getElementById("panelFile"));
	var panelDegree = /** @type {HTMLElement} */(document.getElementById("panelDegree"));
	var panelDelete = /** @type {HTMLButtonElement} */(document.getElementById("panelDelete"));

	/** @type {number} */
	var selectedIndex = -1;
	/** @type {number} */
	var draggingIndex = -1;
	/** @type {{x:number,y:number}} */
	var dragOffset = vec2(0, 0);
	/** @type {{x:number,y:number}} */
	var dragTarget = vec2(0, 0);

	/**
	 * @param {number} idx Node index.
	 * @param {PointerEvent} ev Pointer event.
	 * @returns {void}
	 */
	function beginDrag(idx, ev) {
		if (graph.isFree(idx)) return;
		selectNode(idx);
		draggingIndex = idx;
		var p = clientToSvg(svg, ev.clientX, ev.clientY);
		dragOffset = vec2.sub(p, graph.nodes[idx].pos);
		dragTarget = graph.nodes[idx].pos;
		svg.classList.add("dragging");
		ev.preventDefault();
		ev.stopPropagation();
		svg.setPointerCapture(ev.pointerId);
	}

	/**
	 * @param {PointerEvent} ev Pointer event.
	 * @returns {void}
	 */
	function dragMove(ev) {
		if (draggingIndex < 0) return;
		var p = clientToSvg(svg, ev.clientX, ev.clientY);
		dragTarget = vec2.sub(p, dragOffset);
		graph.nodes[draggingIndex].pos = dragTarget;
		ev.preventDefault();
	}

	/**
	 * @returns {void}
	 */
	function endDrag() {
		draggingIndex = -1;
		svg.classList.remove("dragging");
	}

	svg.addEventListener("pointermove", dragMove);
	svg.addEventListener("pointerup", function() { endDrag(); });
	svg.addEventListener("pointercancel", function() { endDrag(); });

	/**
	 * @param {number} idx Node index.
	 * @returns {void}
	 */
	function selectNode(idx) {
		selectedIndex = idx;
		var node = graph.nodes[idx];
		panel.style.display = "block";
		panelName.textContent = node.name;
		panelDegree.textContent = String(graph.degree(idx));
		if (node.image) {
			panelImg.src = node.image;
			panelImg.style.display = "block";
		} else {
			panelImg.removeAttribute("src");
			panelImg.style.display = "none";
		}
		panelFile.value = "";
	}

	/**
	 * Apply side-panel name edits to the selected node immediately.
	 * @returns {void}
	 */
	function liveRenameFromPanel() {
		if (selectedIndex < 0) return;
		var next = panelName.textContent;
		if (next.trim().length === 0) return;
		var before = graph.nodes[selectedIndex].name;
		graph.renameNode(selectedIndex, next);
		if (graph.nodes[selectedIndex].name !== before) {
			syncFriendDatalist(graph, datalist);
		}
	}

	panelName.addEventListener("input", liveRenameFromPanel);
	panelName.addEventListener("keydown", function(ev) {
		if (ev.key === "Enter") {
			ev.preventDefault();
			panelName.blur();
		}
	});

	svg.addEventListener("pointerdown", function() {
		if (draggingIndex >= 0) return;
		selectedIndex = -1;
		panel.style.display = "none";
		panelName.textContent = "";
		panelDegree.textContent = "0";
		panelImg.removeAttribute("src");
		panelImg.style.display = "none";
		panelFile.value = "";
	});

	panelDelete.addEventListener("click", function() {
		if (selectedIndex < 0) return;
		var idx = selectedIndex;
		var removedPairs = graph.deleteNode(idx);

		var nodeEl = document.getElementById("node" + idx);
		if (nodeEl) nodeEl.remove();
		var clipEl = document.getElementById("clip" + idx);
		if (clipEl) clipEl.remove();

		for (var r = 0; r < removedPairs.length; r++) {
			var eid = edgeId(removedPairs[r][0], removedPairs[r][1]);
			var edgeEl = document.getElementById(eid);
			if (edgeEl) edgeEl.remove();
		}

		selectedIndex = -1;
		panel.style.display = "none";
		panelName.textContent = "";
		panelDegree.textContent = "0";
		panelImg.removeAttribute("src");
		panelImg.style.display = "none";
		panelFile.value = "";
		syncFriendDatalist(graph, datalist);
	});

	resetNameInputs(namesHost);
	yearInput.value = String(new Date().getFullYear());

	namesHost.addEventListener("input", function() {
		ensureTrailingBlank(namesHost);
	});

	addBtn.addEventListener("click", function() {
		var names = collectNames(namesHost);
		var d = parseYearInput(yearInput.value);
		graph.addFriendGroup(names, d);
		syncFriendDatalist(graph, datalist);
		resetNameInputs(namesHost);
	});

	panelFile.addEventListener("change", function() {
		if (selectedIndex < 0) return;
		readAndResizeImage(panelFile, 96).then(function(dataUrl) {
			graph.nodes[selectedIndex].image = dataUrl;
			panelImg.src = dataUrl;
			panelImg.style.display = "block";
		});
	});

	updateViewBox(svg);
	window.addEventListener("resize", function() { updateViewBox(svg); });

	var last = performance.now();
	function frame(now) {
		var dt = (now - last) / 1000;
		last = now;
		if (dt > 0.05) dt = 0.05;

		if (draggingIndex >= 0 && !graph.isFree(draggingIndex)) {
			graph.nodes[draggingIndex].pos = dragTarget;
		}
		graph.update(dt);
		if (draggingIndex >= 0 && !graph.isFree(draggingIndex)) {
			graph.nodes[draggingIndex].pos = dragTarget;
		}
		syncSvg(graph, svg, defs, edgesG, nodesG, selectedIndex, beginDrag);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);
}

main();
