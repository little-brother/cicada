
$(function() {
	var $app = $('#app-diagram').height(window.innerHeight);
	var $page = $app.find('#page');
	var $diagram_list = $app.find('#navigator #diagram-list');
	var $components = $('#components');

	var $elements = {};
	var links = {};
	var graphs = {};

	// INIT
	$app.splitter({limit: 200, onDragEnd});
	$.ajax({
		method: 'GET',
		url: '/diagram',
		dataType: 'json',
		success: function (diagrams) {
			diagrams.forEach(updateNavigatorDiagram);
			$diagram_list.trigger('update-status');
		}
	});
	setInterval(() => $app.trigger('clear-alert-list'), 60 * 60 * 1000); // 1 hour

	// VIEW
	function updateNavigatorDiagram(diagram) {
		var $e = $diagram_list.find('#' + diagram.id);
		if ($e.length == 0)	
			$e = $('<li/>')
				.attr('id', diagram.id)
				.append('<div id = "name"/>')
				.appendTo($diagram_list);
		
		$e.attr('status', diagram.status || 0);
		$e.find('#name').html(diagram.name);
		return $e;			
	}

	$diagram_list.on('update-status', function() {
		$diagram_list.closest('#navigator').attr('status', Math.max.apply(null, $diagram_list.find('li').map((i, e) => e.getAttribute('status') || 0)));
	});	

	$app.on('click', '#diagram-list li', function(e, data) {
		$page.empty();
		links = {};
		graphs = {};
		
		var $e = $(this);
		if ($e.hasClass('active') && !!e.originalEvent)
			return $e.removeClass('active');

		var diagram_id = $e.attr('id');
		$.ajax({
			method: 'GET',
			url: '/diagram/' + diagram_id,
			dataType: 'json',
			success: function(diagram) {
				$diagram_list.find('li.active').removeClass('active');
				$e.addClass('active').attr('status', diagram.status);

				var $component = $components.find('#page-diagram-view').clone();
				$component.find('.top-menu').find('#diagram-remove').attr('diagram-id', diagram_id);
				$component.find('.top-menu').find('#diagram-edit').data('diagram', diagram);
				$component.appendTo($page);	

				$page.find('#diagram').trigger('resize-canvas');

				$elements = {};
				var $diagram = $page.find('#diagram');
				diagram.element_list.forEach(function(e) {
					var $e = $('<div/>')
						.attr('id', e.id)
						.attr('type', e.type)
						.css({
							width: e.width || 100,
							height: e.height || 100,
							left: e.x || 100,
							top: e.y || 100
						})
						.addClass('element')
						.appendTo($diagram);

					if (e.image)
						$e.css('background-image', 'url("/images/' + e.image + '")');

					if (e['z-index'])
						$e.css('z-index', parseInt(e['z-index']) || 2);

					if (e['font-size'])
						$e.css('font-size', parseInt(e['font-size']) || 14);

					if (e['color'])
						$e.css('color', e.color);

					if (e.label)
						$e.attr('label');

					if (e.text)
						$e.html(e.text);

					if (e.status != undefined || e.value != undefined)
						$e.trigger('update-element', {status: e.status, value: e.value, value_type: e.value_type});

					if (e.path)
						$e.attr('title', e.path);

					if (e.type == 'device' && e.label == '@name')
						$e.attr('label', e.path);

					if (e.type == 'device' || e.type == 'diagram')
						$e.addClass('status');

					if (e.type == 'diagram')
						$e.attr('diagram-id', e['diagram-id']);

					if (e.type == 'graph' && !isNaN(e.min) && !isNaN(e.max))
						$e.range = [parseFloat(e.min), parseFloat(e.max)];

					var device_id = parseInt(e['device-id']) || '';
					var varbind_id = parseInt(e['varbind-id']) || '';
					if (device_id) {
						$e.device_id = device_id;
						$e.varbind_id = varbind_id;

						$e.attr('device-id', device_id);
						$e.attr('varbind-id', varbind_id);

						if (!$elements[device_id])
							$elements[device_id] = [];

						$elements[device_id].push($e);
					}
				});

				diagram.element_list
					.filter((e) => e.type == 'graph')
					.map((e) => e['device-id'])
					.filter((e, i, arr) => arr.indexOf(e) == i) // unique
					.forEach(function (device_id) {
						$.ajax({
							method: 'GET',
							url: '/device/' + device_id + '/varbind-history',
							dataType: 'json',
							success: (history) => $app.trigger('history-ready', [device_id, history])
						})
					});

				links = {};
				diagram.element_list
					.filter((e) => e.type == 'link' && e['parent-id'])
					.forEach(function(e) {
						var $e = $diagram.find('#' + e.id);
						var $parent = $diagram.find('#' + e['parent-id']);

						var link = $.extend({}, e, {
							from: {x: $parent.position().left + $parent.width() / 2, y: $parent.position().top + $parent.height() / 2},
							to: {x: e.x, y: e.y}
						});
;
						$e.css({
							width: 'initial',
							height: 'initial',
							left: (link.to.x + link.from.x) / 2 - 12,
							top: (link.to.y + link.from.y) / 2 - 12
						});

						links[e.id] = link;
						$e.trigger('update-element', {status: e.status, value: e.value});
					});

				var canvas = $page.find('#canvas').get(0);
				var ctx = canvas.getContext('2d');
				$.each(links, (i, e) => drawLink(ctx, e));

				$.ajax({
					method: 'GET',
					url: '/alert',
					data: {from: roundTime()},
					success: function (alert_list) {
						alert_list.forEach((a) => $app.trigger('alert-info', a))
					} 
				});
			}
		});
	});	

	$app.on('update-element', '#page-diagram-view #diagram .element[type="device"]', function (event, data, time) {
		this.setAttribute('status', data.status || 0);
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="status"]', function (event, data, time) {
		this.setAttribute('status', data.status || 0);
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="diagram"]', function (event, data, time) {
		this.setAttribute('status', data.status || 0);
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="value"]', function (event, data, time) {
		this.setAttribute('status', data.status || 0);
		this.innerHTML = cast(data.value_type || 'number', data.value) || '';
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="graph"]', function (event, data, time) {
		var graph = graphs[this.id];
		if (!graph)
			return;
	
		var hour = 1000 * 60 * 60; 
		var file = graph.file_.filter((e) => e[0].getTime() + hour > time);
		if (!isNaN(data.value))
			file.push([new Date(time), data.value]);

		graph.updateOptions({file: file});
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="link"]', function (event, data) {
		if (!data)
			data = {status: 0};
		
		var value = cast(data.value_type || 'number', data.value) || '';	

		this.innerHTML = value;
		var link = links[this.id];
		if (!link)
			return;	

		link.status = data.status;
		link.value = value;

		var ctx = $page.find('#canvas').get(0).getContext('2d');
		drawLink(ctx, link);
	});

	var popupTimer;
	$app.on('mouseenter', '#page-diagram-view .element', function (event) {
		var $e = $(this);
		var $diagram = $e.parent();
		$diagram.find('#history').remove();
		clearTimeout(popupTimer);

		var type = $e.attr('type');
		var device_id = parseInt($e.attr('device-id')) || '';
		var varbind_id = parseInt($e.attr('varbind-id')) || '';

		if (!device_id || ['device', 'status', 'value', 'link'].indexOf(type) == -1 || this.hasAttribute('no-history'))
			return;

		function addGraph ($e, data, name, height) {
			var opts = { 
				axes : { 
					x :  {drawAxis : false, drawGrid: false, valueFormatter: (ms) => cast('datetime', ms)},
				},
				labels: ['time', name],
				height: height,
				width: 300,
				valueRange: getRange(data),
				highlightCircleSize: 2,					
				drawPoints: true,
				connectSeparatedPoints: true,
				legendFormatter: (data) => (data.x !== null && data.series && data.series[0].yHTML) ? data.xHTML + ': <b>' + data.series[0].yHTML + '</b>' : ''
			};

			if (height < 100)
				opts.axes.y = {drawAxis : false, drawGrid: false};
			
			new Dygraph($('<div/>').attr('title', name).appendTo($e).get(0), data, opts);
		}

		$.ajax({
			method: 'GET',
			url: '/device/' + device_id + '/varbind-history',
			dataType: 'json',
			success: function (history) {
				var idx = history.ids && history.ids.indexOf(varbind_id);

				if (!history.ids || varbind_id && idx == -1)	
					return $e.attr('no-history', true);

				var position = $e.position();
				var height = 200;
				var graph_height = (varbind_id) ? height : height / history.ids.length;

				

				var $history = $('<div/>')
					.attr('id', 'history')
					.css('top', $diagram.height() - position.top - $e.height() - 15 < height ? position.top - height - 15 : position.top + $e.height() + 15)
					.css('left', position.left + 300 < $diagram.width() ? position.left : position.left - 300 + $e.width())
					.appendTo($diagram);

				if (varbind_id) 
					addGraph($history, history.rows.map((row) => [new Date(row[0]), row[idx + 1]]), history.columns[idx + 1], graph_height);
				else 
					history.ids.forEach((id, idx) => addGraph($history, history.rows.map((row) => [new Date(row[0]), row[idx + 1]]), history.columns[idx + 1], graph_height))	

				$e.one('mouseleave', () => $history.trigger('mouseleave'));
			}
		});
	});

	$app.on('mouseenter', '#page-diagram-view #diagram #history', function (event) {
		clearTimeout(popupTimer);
	});

	$app.on('mouseleave', '#page-diagram-view #diagram #history', function (event, delay) {
		clearTimeout(popupTimer);
		popupTimer = setTimeout(() => $(this).remove(), delay || 300);
	});

	$app.on('history-ready', function (event, device_id, history) {
		($elements[device_id] || [])
			.filter(($e) => $e.attr('type') == 'graph')
			.filter(($e) => history.ids.indexOf($e.varbind_id) != -1)
			.forEach(function ($e) {
				var idx = history.ids.indexOf($e.varbind_id);
				var data = history.rows.map((row) => [new Date(row[0]), row[idx + 1]]).filter((row) => !isNaN(row[1]));
				
				var id = $e.attr('id');
				if (graphs[id]) {
					try {
						graphs[id].graphDiv.parentNode.remove();
						graphs[id].destroy();
						delete graphs[id];
					} catch (err) {
						console.error(err);
					}
				} 
				
				var opts = { 
					axes : { 
						x :  {drawAxis : false, drawGrid: false, valueFormatter: (ms) => cast('datetime', ms)},
						y :  {drawAxis : false, drawGrid: false} 
					},
					labels: ['time', history.columns[idx + 1]],
					xlabel: history.columns[idx + 1],
					valueRange: $e.range || getRange(data),
					highlightCircleSize: 2,					
					drawPoints: true,
					connectSeparatedPoints: true,
					legendFormatter: (data) => (data.x !== null && data.series && data.series[0].yHTML) ? data.xHTML + ': <b>' + data.series[0].yHTML + '</b>' : ''
				};
				graphs[id] = new Dygraph($e.get(0), data, opts);
			});
	});

	$app.on('mouseenter', '#page-diagram-view #alert-list .alert', function (event) {
		var device_id = this.getAttribute('device-id');
		(device_id && $elements[device_id] || []).forEach(($e) => $e.attr('highlight', true));
	});

	$app.on('mouseleave', '#page-diagram-view #alert-list .alert', function (event) {
		var device_id = this.getAttribute('device-id');
		(device_id && $elements[device_id] || []).forEach(($e) => $e.removeAttr('highlight'));
	});

	$app.on('clear-alert-list', function() {
		var $alert_list = $page.find('#alert-list');
		if (!$alert_list.length)
			return;

		var now = new Date().getTime();
		var day = 24 * 60 * 60 * 1000;
		$alert_list.find('.alert')
			.filter((i, e) => now - parseInt(e.getAttribute('time')) > day)
			.each((i, e) => $(e).trigger('mouseleave').remove())
	});

	$app.on('values-updated', function (event, packet) {
		var $element_list = $elements[packet.id];
		if (!$element_list)
			return;

		var values = {};
		packet.values.forEach((v) => values[v.id] = v);
		$element_list.forEach(($e) => $e.trigger('update-element', [$e.varbind_id ? values[$e.varbind_id] : {status: packet.status}, packet.time]));
	});

	$app.on('diagram-status-updated', function (event, packet) {
		$diagram_list.find('li#' + packet.id).attr('status', packet.status || 0);
		$diagram_list.trigger('update-status');
		
		$page.find('#diagram .element[type="diagram"][diagram-id="' + packet.id + '"]').trigger('update-element', {status: packet.status || 0}, packet.time);
	});

	$app.on('alert-info', function (event, alert) {
		var $alert_list = $page.find('#alert-list');
		var element_list = $elements && $elements[alert.device_id];
		if (!$alert_list.length || !element_list)
			return;

		$('<li/>')
			.attr('id', alert.id)	
			.attr('device-id', alert.device_id)
			.attr('status', alert.status)
			.attr('time', alert.time)
			.attr('is-hidden', !!alert.is_hidden)
			.addClass('alert')	
			.html(cast('time', alert.time) + ': ' + alert.reason)
			.attr('title', alert.reason)
			.appendTo($alert_list);	
	});

	$app.on('click', '#page-close', function() {
		$elements = {};
		links = {};
		$page.empty();
		$diagram_list.find('li.active').removeClass('active');
	});

	// EDIT
	$app.on('click', '#page-diagram-view #diagram-edit, #navigator #diagram-add', function() {
		var diagram = $(this).data('diagram') || {element_list: []};
		
		$page.empty();
		var $component = $components.find('#page-diagram-edit').clone(true, true);
		$component.find('.top-menu #name').val(diagram.name);
		if (diagram.id)	
			$component.find('.top-menu #diagram-save, .top-menu #diagram-save-cancel').attr('diagram-id', diagram.id);
		$component.appendTo($page);

		stores = {};
		var ids = $components.find('select[store]').map((i, e) => e.getAttribute('store')).get().filter((e, i, arr) => arr.indexOf(e) == i);

		loadStores(ids, function () {
			$editor = $page.find('#page-diagram-edit #diagram');
			$editor.trigger('resize-canvas'); 
			diagram.element_list.forEach((e) => $editor.trigger('add-element', e));
			$editor.trigger('update-canvas');
			$editor.trigger('set-current');
		});
	});

	$page.on('click', '#page-diagram-view #diagram-remove', function() {
		var id = $(this).attr('diagram-id');
		$.ajax({
			method: 'DELETE',
			url: '/diagram/' + id,
			success: function() {
				$diagram_list.find('#' + id).remove();
				$page.empty();
			}
		});
	});

	$page.on('click', '#page-diagram-edit #diagram-save', function() {
		var fields = {};
		var element_list = $editor.find('.element').map(function(i, e) {
			var $e = $(e);
			var props = $e.data('props');
			
			var type = props.type;
			if (!fields[type]) {
				fields[type] = $components.find('#partial-diagram-' + type + '-props').find('select, input, textarea').map((i, e) => e.id).get() || [];

				if (type == 'link')
					fields[type].push('parent-id');
			}

			var obj = {};
			fields[type].forEach((e) => obj[e] = props[e]);

			return $.extend(obj, {
				id: e.id,
				type: type,
				width: $e.width(),
				height: $e.height(),
				x: $e.position().left,
				y: $e.position().top	
			});
		}).get();

		var $e = $(this);
		var data = {
			id: $e.attr('diagram-id'),
			name: $page.find('.top-menu #name').val() || 'No name',
			json_element_list: JSON.stringify(element_list)
		};

		$.ajax({
			method: 'POST',
			url: '/diagram',
			data: data,
			success: function (id) {
				data.id = id;
				updateNavigatorDiagram(data).click();
				$diagram_list.trigger('update-status');
			}			
		});
	});

	$page.on('click', '#page-diagram-edit #diagram-save-cancel', function() {
		$page.find('page-close').trigger('click');
		$diagram_list.find('li#' + $(this).attr('diagram-id')).trigger('click');	
	});

	var stores = {};
	var stop = (event) => event.stopImmediatePropagation();
	var $editor;

	$page.on('resize-canvas', '#page-diagram-view #diagram, #page-diagram-edit #diagram', function () {
		var $e = $(this);
		var canvas = $e.find('#canvas').get(0);
		var $wrapper = $app.find('#page-wrapper');
		var height = $wrapper.height() - $page.height();
		canvas.width = $e.width();
		canvas.height = height;
		$e.height(height);
	});

	$page.on('click', '#page-diagram-edit .add-element', function (event) {
		var data = $(this).data('element');
		data.id = new Date().getTime();
		$editor.trigger('add-element', [$.extend({}, data), true]);
	});		

	$page.on('update-canvas', '#page-diagram-edit #diagram', function (event, newlink) {
		var canvas = $editor.find('#canvas').get(0);
		var ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		
		var offset = $editor.offset();
		$editor.find('.link').each(function (i, e) {
			var $e = $(e);
			var $parent = $editor.find('#' + $e.attr('parent-id'));

			if (!$parent.length) {
				delete links[e.id];
				$e.remove();	
				return;
			}

			var link = $e.data('props');
			link.from = {x: $parent.position().left + $parent.width() / 2, y: $parent.position().top + $parent.height() / 2};
			link.to = {x: $e.position().left + $e.width() / 2, y: $e.position().top + $e.height() / 2};

			drawLink(ctx, link);
		})

		if (newlink)
			drawLink(ctx, newlink);
	});

	$page.on('add-element', '#page-diagram-edit #diagram', function (event, data, current) {
		if (!data || !data.id)
			return console.error('Incorrect request to create object', data);

		//console.log('ADD', data);
		var $e = $('<div/>')
			.attr('id', data.id)
			.attr('parent-id', data['parent-id'])
			.attr('type', data.type)
			.attr('title', data.type)
			.addClass('element')
			.addClass(data.type)
			.css({top: data.y || 100, left: data.x || 100, width: data.width || data.type != 'link' && 100 || 10, height: data.height  || data.type != 'link' && 100 || 10})
			.data('props', data)
			.appendTo($editor);

		$('<div/>').attr('id', 'remove').html('&#10006;').appendTo($e);
		if (data.type == 'device' || data.type == 'diagram' || data.type == 'image')
			$('<div/>').attr('id', 'link-add').attr('title', 'Add link').appendTo($e);
		$('<div/>').attr('id', 'resize').appendTo($e);

		$e.trigger('set-current', [data.id, (current) ? '' : 'hidden']);
	});

	$page.on('set-current', '#page-diagram-edit #diagram', function (event, id, mode) {
		$editor.attr('mode', mode || '').attr('current', id || '');

		var $prev = $editor.find('.element[current]');
		if ($prev.length && $prev.attr('id') == id && $prev.has('#props'))
			return;

		if ($prev.length && $prev.attr('id') != id)
			$prev.removeAttr('current').find('#props').remove();

		if (!id)
			return;

		var $e = $editor.find('#' + id);
		if (!$e.length || mode == 'move' || mode == 'resize')
			return;

		$components.find('#partial-diagram-' + $e.attr('type') + '-props').clone().attr('id', 'props').appendTo($e);	
		$e.attr('current', true);
		var props = $e.data('props') || {};
		$e.find('select[store]').each((i, e) => createSelect($(e), props[e.id]));
		$.each(props, (prop, value) => $e.find('#props #' + prop).val(value).trigger('change', [true, props['varbind-id']]));

		if (mode == 'hidden')
			$e.removeAttr('current').find('#props').remove();
	});

	$page.on('mousedown', '#page-diagram-edit #diagram', (event) => stop(event) || $editor.trigger('set-current')); 
	$page.on('mousedown', '#page-diagram-edit #diagram .element', function (event) {
		stop(event);
		var $e = $(event.target);
		var mode = $e.hasClass('link') || (Math.pow($e.width() - event.offsetX, 2) + Math.pow($e.height() - event.offsetY, 2) >= 200) ? 'move' : 'resize';
		$editor.data('click', {x: event.offsetX, y: event.offsetY}).trigger('set-current', [event.currentTarget.id, mode]);
	});

	$page.on('mousedown', '#page-diagram-edit #diagram .element #remove', function (event) {
		stop(event);
		var $e = $(this).parent();
		$editor.find('.element[parent=' + $e.attr('id') + ']').remove();
		$e.remove();
		
		$editor.trigger('set-current');
		$editor.trigger('update-canvas');	
	});

	$page.on('dblclick', '#page-diagram-edit #diagram .element.link', (event) => $(event.currentTarget).find('#remove').trigger('mousedown')); 

	$page.on('mousedown', '#page-diagram-edit #diagram .element #link-add', function (event) {
		stop(event);
		
		var offset = $editor.offset();
		var link = {
			id: new Date().getTime(),
			type: 'link',
			x: event.pageX - offset.left - 5,
			y: event.pageY - offset.top - 5,	
			depth: 10,
			width: 10,
			height: 10,
			color: '#000',
			'parent-id': this.parentElement.id,
			'device-id': $(this).closest('.element').data('props')['device-id']
		}
		$editor.trigger('add-element', link);

		$editor.data('click', {x: event.offsetX, y: event.offsetY}).trigger('set-current', [link.id, 'move']);
	});

	$page.on('mousemove', '#page-diagram-edit #diagram', function(event) {
		stop(event);
		var mode = $editor.attr('mode');
		var $e = $editor.find('#' + ($editor.attr('current') || 'none'));
		if (!$e.length || !mode)		
			return;

		if (mode == 'move') {
			var click = $editor.data('click');
			$e.offset({top: event.pageY - click.y, left: event.pageX - click.x});
			$editor.trigger('update-canvas');
		}

		if (mode == 'resize') {
			$e.css({width: event.clientX - $e.offset().left, height: event.clientY - $e.offset().top});
			$editor.trigger('update-canvas');
		}		
	});


	$page.on('mouseup', '#page-diagram-edit #diagram', function (event) {
		var click = $editor.data('click');
		$editor.trigger('set-current', [$editor.attr('current'), click && (click.x != event.offsetX || click.y != event.offsetY) ? 'hidden' : ''])
	});

	$page.on('mousedown', '#page-diagram-edit #diagram .element #props', (event) => stop(event));
	$page.on('mouseup', '#page-diagram-edit #diagram .element #props', (event) => stop(event));

	$page.on('change', '#page-diagram-edit #diagram .element #props #image', function () {
		var $e = $(this).closest('.element');
	
		if (this.value == 'upload')
			return;
		
		if (!this.value)
			return $e.css('background-image', '');

		if (this.value)
			$e.css({'background-image': 'url("' + this.getAttribute('store') + '/' + this.value + '")', 'background-size': 'cover'});
	});

	$page.on('change', '#page-diagram-edit #diagram .element #props #label', function () {
		$(this).closest('.element').attr('label', this.value);
	});

	$page.on('change', '#page-diagram-edit #diagram .element #props #text', function () {
		$(this).closest('.element').attr(this.id, this.value);
	});

	$page.on('change', '#page-diagram-edit #diagram .element #props #font-size', function () {
		$(this).closest('.element').css('font-size', parseInt(this.value));
	});

	$page.on('change', '#page-diagram-edit #diagram .element #props #z-index', function () {
		$(this).closest('.element').css('z-index', parseInt(this.value));
	});

	$page.on('change', '#page-diagram-edit #diagram .element #props #color', function () {
		$(this).closest('.element').css('color', this.value);
	});


	$page.on('change', '#page-diagram-edit #diagram .element #props *', function (event, skip_update) {
		if (skip_update || !this.id)
			return;

		var $e = $(this).closest('.element');
		var props = $e.data('props');
		props[this.id] = this.value;
		$e.data('props', props);

		if ($e.hasClass('link'))
			$editor.trigger('update-canvas');
	});

	$page.on('change', '#page-diagram-edit #diagram .element #props #device-id[store]', function(event, skip_update, varbind_id) {
		var $e = $(this);
		var $varbind_id = $e.closest('#props').find('#varbind-id');

		if (!$varbind_id.length)
			return;

		if (!$e.val())
			return $varbind_id.empty();
		
		var store = '/device/' + $e.val() + '/varbind-list';
		$varbind_id.attr('store', store);
		loadStore(store, () => createSelect($varbind_id, varbind_id));	
	});

	$page.on('change', '#page-diagram-edit .element #props select[store]', function () {
		if (this.value != 'upload') 
			return true;

		var $e = $(this);
		var $upload = $('#upload');

		var store_id = $e.attr('store');	
		$upload.off().on('change', function() {
			$upload.attr('name', store_id);
			$.ajax({
				type: 'POST',
				url: '/upload',
				data: new FormData(this.parentElement),
				processData: false,
				contentType: false,
				success: function (filename) {
					var store = stores[store_id];
					store[filename] = filename;
					createSelect($e, filename);
					$e.trigger('change');
				}
			});
			return false;
		});
		
		$upload.click();
	});

	function loadStore(id, cb) {
		var store = stores[id];
		if (store)
			return cb && cb();

		console.log('Loading ', id)
		stores[id] = {};
		$.ajax({
			method: 'GET',
			url: id,
			dataType: 'json',
			success: (res) => res.forEach((e) => e instanceof Object ? stores[id][e.id] = e.name : stores[id][e] = e) || cb && cb()
		});
	}

	function loadStores(ids, cb) {
		if (!(ids instanceof Array) || !ids)
			return cb && cb();

		var complete = 0;
		ids.forEach((id) => loadStore(id, () => complete++ && complete == ids.length && cb && cb()));
	}

	function createSelect($e, selected) {
		var addOption = (key, value) => $('<option/>').attr('value', key).html(value).appendTo($e);

		var store_id = $e.attr('store');
		var store = stores[store_id];

		if (!store_id || !store)
			return console.error('Store "' + store_id + '" is empty');

		$e.find('option').remove();
		
		if ($e.attr('none'))
			addOption('', 'none');

		$.map(store, (e, i) => i).sort().forEach((e) => addOption(e, store[e]));

		if ($e.attr('upload'))
			addOption('upload', 'Upload...');

		if (selected)
			$e.val(selected);
		else {
			$e.prop('selectedIndex', 0);
			$e.trigger('change');
		}
	}

});