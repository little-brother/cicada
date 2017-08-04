// Short version
(function() {
'use strict';

var Dygraph	= window.Dygraph;

var synchronize = function(dygraphs) {
	if (!dygraphs || dygraphs.length < 2)
		return;

	var prevCallbacks = [];
	dygraphs.forEach(function(g, j) {
		prevCallbacks[j] = {
			'drawCallback': g.getFunctionOption('drawCallback'),
			'highlightCallback': g.getFunctionOption('highlightCallback'),
			'unhighlightCallback': g.getFunctionOption('unhighlightCallback')
		}
	});

	attachZoomHandlers(dygraphs, prevCallbacks);
	attachSelectionHandlers(dygraphs, prevCallbacks);
};

function arraysAreEqual(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	var i = a.length;
	if (i !== b.length) return false;
	while (i--) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function attachZoomHandlers(gs, prevCallbacks) {
	var block = false;
	for (var i = 0; i < gs.length; i++) {
		var g = gs[i];
		g.updateOptions({
			drawCallback: function(me, initial) {
				if (block || initial) return;
				block = true;
				var opts = {
					dateWindow: me.xAxisRange()
				};

				for (var j = 0; j < gs.length; j++) {
					if (gs[j] == me) {
						if (prevCallbacks[j] && prevCallbacks[j].drawCallback) {
							prevCallbacks[j].drawCallback.apply(this, arguments);
						}
						continue;
					}

					// Only redraw if there are new options
					if (arraysAreEqual(opts.dateWindow, gs[j].getOption('dateWindow')) && 
							arraysAreEqual(opts.valueRange, gs[j].getOption('valueRange'))) {
						continue;
					}

					gs[j].updateOptions(opts);
				}
				block = false;
			}
		}, true /* no need to redraw */);
	}
}

function attachSelectionHandlers(gs, prevCallbacks) {
	var block = false;
	for (var i = 0; i < gs.length; i++) {
		var g = gs[i];

		g.updateOptions({
			highlightCallback: function(event, x, points, row, seriesName) {
				if (block) return;
				block = true;
				var me = this;
				for (var i = 0; i < gs.length; i++) {
					if (me == gs[i]) {
						if (prevCallbacks[i] && prevCallbacks[i].highlightCallback) {
							prevCallbacks[i].highlightCallback.apply(this, arguments);
						}
						continue;
					}
					var idx = gs[i].getRowForX(x);
					if (idx !== null) {
						gs[i].setSelection(idx, seriesName);
					}
				}
				block = false;
			},
			unhighlightCallback: function(event) {
				if (block) return;
				block = true;
				var me = this;
				for (var i = 0; i < gs.length; i++) {
					if (me == gs[i]) {
						if (prevCallbacks[i] && prevCallbacks[i].unhighlightCallback) {
							prevCallbacks[i].unhighlightCallback.apply(this, arguments);
						}
						continue;
					}
					gs[i].clearSelection();
				}
				block = false;
			}
		}, true /* no need to redraw */);
	}
}

Dygraph.synchronize = synchronize;
})();