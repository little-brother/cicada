$(function() {
	var $app = $('.app');
	var popupTimer;
	var graph_list = [];

	function resetHint($parent) {
		graph_list.forEach(function (graph) {
			try {
				graph.destroy();
			} catch (err) { }
		});
		graph_list = [];

		$parent.find('#graph-hint').remove();
		clearTimeout(popupTimer);
	}

	$app.on('mouseenter', '.graph-hint', function (event, event_data) {
		var $e = $(this);
		var $parent = $e.closest('.graph-hint-parent');

		var type = $e.attr('type');
		var device_id = parseInt($e.attr('device-id')) || '';
		var varbind_id = parseInt($e.attr('varbind-id')) || '';
		var time = parseInt($e.attr('time')) || '';

		resetHint($parent);

		if (!device_id || this.hasAttribute('no-history'))
			return;

		function addGraph ($e, data, alerts, name, height) {
			normalizeHistory(data);
			var opts = { 
				axes : { 
					x :  {drawAxis : false, drawGrid: false, valueFormatter: (ms) => cast('time', ms)},
					y: {drawAxis : false, drawGrid: false, valueFormatter: (val) => round2(val)}
				},
				labels: ['time', name],
				height: height,
				width: 300,
				stackedGraph: true,
				highlightCircleSize: 2,					
				drawPoints: true,
				connectSeparatedPoints: true,
				drawPointCallback: function (g, seriesName, canvasContext, cx, cy, seriesColor, pointSize, row, idx) {
					var event_time = g.getValue(row, 0);

					if (time && event_time == time)
						drawMark(canvasContext, cx, cy - 15, '#f0f');

					var status = alerts[event_time];
					if (status)	
						drawCircle(canvasContext, cx, cy, getStatusColor(status), 2);
				},
				legendFormatter: (data) => (data.x !== null && data.series && data.series[0].yHTML) ? data.xHTML + ': <b>' + data.series[0].yHTML + '</b>' : ''
			};

			var min = data[0][0];
			var max = data[0][0];
			data.forEach(function (e) {
				if (isNaN(min[1]) || !isNaN(e[1]) && e[1] < min[1])
					min = e;

				if (isNaN(max[1]) || !isNaN(e[1]) && e[1] > max[1])
					max = e;
			})
			
			var graph = new Dygraph($('<div/>').attr('caption', name).attr('range', round2(min[1]) + '...' + round2(max[1])).addClass('graph-hint-row').appendTo($e).get(0), data, opts);
			graph.alerts = alerts;
			graph_list.push(graph);
			

			var ctx = graph.canvas_.getContext('2d');
			drawCircle(ctx, graph.toDomXCoord(min[0]), graph.toDomYCoord(min[1]), 'purple', 2);
			drawCircle(ctx, graph.toDomXCoord(max[0]), graph.toDomYCoord(max[1]), 'purple', 2);
		}


		function addHint(history) {
			var idx = history.ids && history.ids.indexOf(varbind_id);

			if (!history.ids || varbind_id && idx == -1)	
				return $e.attr('no-history', true);

			if (time && !$e.data().hasOwnProperty('history'))
				$e.data('history', history);

			var position = $e.position();
			var height = 200;
			var graph_height = (varbind_id) ? height : height / history.ids.length;

			resetHint($parent);
			var $hint = $('<div/>')
				.attr('id', 'graph-hint')
				.css('top', $parent.closest('#page-wrapper').height() - position.top - $e.height() - 15 < height ? position.top - height - 15 : position.top + $e.outerHeight())
				.css('left', position.left + 300 < $parent.width() ? position.left : position.left - 300 + $e.width())
				.appendTo($parent);


			if (varbind_id) 
				addGraph($hint, history.rows.map((row) => [new Date(row[0]), row[idx + 1]]), history.alerts[varbind_id] || {}, history.columns[idx + 1], graph_height);
			else 
				history.ids.forEach((id, idx) => addGraph($hint, history.rows.map((row) => [new Date(row[0]), row[idx + 1]]), history.alerts[id] || {}, history.columns[idx + 1], graph_height))	
		}

		var history = time ? $e.data('history') : null;
		if (history)
			return addHint(history);

		var hour = 60 * 60 * 1000;
		var url = '/device/' + device_id + '/varbind-history?1=1';
		if (varbind_id) 
			url += '&only=' + varbind_id;
		if (time)
			url += '&from=' + (time - hour/2) + '&to=' + (time + hour/2); // +- half-hour
		
		$.ajax({method: 'GET', url, dataType: 'json', success: addHint});
	});

	$app.on('mouseenter', '.graph-hint-parent #graph-hint', function (event) {
		clearTimeout(popupTimer);
	});

	$(window).on('focus', () => $app.find('.graph-hint-parent #graph-hint').trigger('mouseleave', 1));

	$app.on('mouseleave', '.graph-hint-parent #graph-hint', function (event, delay) {
		clearTimeout(popupTimer);
		popupTimer = setTimeout(() => $(this).remove(), delay || 300);
	});

	$app.on('mouseleave', '.graph-hint-parent .graph-hint', function (event, delay) {
		clearTimeout(popupTimer);
		popupTimer = setTimeout(() => $(this).closest('.graph-hint-parent').find('#graph-hint').remove(), delay || 300);
	});
});