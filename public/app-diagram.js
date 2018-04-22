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
		if ($e.hasClass('active') && !!e.originalEvent) {
			$app.trigger('notify', {diagram_id: 0});
			return $e.removeClass('active');
		}

		var diagram_id = parseInt($e.attr('id')) || 0;
		$app.trigger('notify', {diagram_id});

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
				$diagram.css('background', diagram.bgcolor || '#fff');

				diagram.element_list.forEach(function(e) {
					var $e = $('<div/>')
						.attr('id', e.id)
						.attr('type', e.type)
						.css({
							width: e.width || 100,
							height: e.height || 100,
							left: nvl(e.x, 100),
							top: nvl(e.y, 100)
						})
						.addClass('element')
						.addClass(e.type)
						.appendTo($diagram);

					if (e.image)
						$e.css('background-image', 'url("/images/' + e.image + '")');

					if (e['z-index'])
						$e.css('z-index', e['z-index']);

					if (e['color'])
						$e.css('color', e.color);

					if (e.text)
						$e.html(e.text);

					if (e.status != undefined || e.value != undefined)
						$e.trigger('update-element', {status: e.status, value: e.value, value_type: e.value_type});

					if (e.path)
						$e.attr('title', e.path);

					if (e.label) {
						var labels = e.label.split(';').map((label) => label == '@name' ? e.path : label);
						$e.attr('label', labels[0]);
						for (var i = 0; i <= 3; i++)
							$e.attr('label' + i, labels[i] || labels[0]);
					}

					if (e.type == 'status' && e.label && e.label == '@value')
						$e.attr('live-value', true);

					if (['diagram', 'device', 'value', 'status'].indexOf(e.type) != -1)
						$e.addClass('status');

					if (e.type == 'text')
						$e.css({
							'font-size': Math.floor(e.height * 0.75) + 'px',
							'line-height': e.height + 'px',
							'min-width': e.width || 100,
							'width': ''	
						});

					if (e.type == 'diagram') {
						var status = $diagram_list.find('#' + e['diagram-id']).attr('status');
						$e.attr('diagram-id', e['diagram-id']).attr('status', status);
					}

					if (e.type == 'graph' && !isNaN(e.min) && !isNaN(e.max))
						$e.range = [parseFloat(e.min), parseFloat(e.max)];

					if (['device', 'status', 'value', 'link'].indexOf(e.type) != -1)	
						$e.addClass('graph-hint');

					if (e.type == 'value') {
						if (e.is_history) {
							['min', 'max', 'unit'].forEach((prop) => $e.attr(prop, e[prop]));
							$e.addClass('numeric');
							$e.addClass(e.height < 30 ? 'hvalue' : e.width < 30 ? 'vvalue' : 'bvalue');
						} else {
							$e.addClass('bvalue');
						}
						
						if ($e.hasClass('bvalue')) {
							$e.css({
								'font-size': Math.floor(e.height * 0.75) + 'px',
								'line-height': e.height + 'px',
								'min-width': e.width || 100,
								'width': ''	
							});
						} else {
							if ($e.height() < 10 || $e.width() < 10) 
								$e.addClass('no-label');
							$('<div/>').appendTo($e);
						}

						$e.trigger('update-element', e);
					}
		
					['live-label', 'live-label-color', 'live-image', 'live-bgcolor']
						.filter((prop) => e[prop])
						.forEach((prop) => $e.attr(prop, true));

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

						var link = $.extend(true, {}, e, {
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
		this.setAttribute('value', cast(data.value_type || 'number', data.value));
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="diagram"]', function (event, data, time) {
		this.setAttribute('status', data.status || 0);
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="value"]', function (event, data, time) {
		var $e = $(this);
		$e.attr('status', data.status || 0);
			
		var value = cast(data.value_type || 'number', data.value);
		if ($e.hasClass('bvalue')) 
			return $e.html(value);	

		var unit = $e.attr('unit') || '';
		var min = nvl($e.attr('min'), 0);
		var max = nvl($e.attr('max'), 100);
		var size = 100 - Math.round((value - min) * 100 / (max - min));
		var prop = $e.width() > $e.height() ? 'width' : 'height';	
		$e.find('div')[prop](size + '%');
		$e.attr('value', value + unit);
	});

	$app.on('update-element', '#page-diagram-view #diagram .element[type="graph"]', function (event, data, time) {
		var graph = graphs[this.id];
		if (!graph)
			return;
	
		var hour = 1000 * 60 * 60; 
		var file = graph.file_.filter((e) => e[0].getTime() + hour > time);

		if (data.status == 2 || data.status == 3)
			graph.alerts[time] = data.status;

		if (isNaN(data.value))
			graph.strings[time] = data.value;

		file.push([new Date(time), !isNaN(data.value) ? data.value : file[file.length - 1]]);

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

	$app.on('history-ready', function (event, device_id, history) {
		($elements[device_id] || [])
			.filter(($e) => $e.attr('type') == 'graph')
			.filter(($e) => history.ids.indexOf($e.varbind_id) != -1)
			.forEach(function ($e) {
				var idx = history.ids.indexOf($e.varbind_id);
				var data = history.rows.map((row) => [new Date(row[0]), row[idx + 1]]).filter((row) => !isNaN(row[1]));
				normalizeHistory(data);


				var alerts = history.alerts[$e.varbind_id] || {};
				var strings = {};
				data.filter((row) => !$.isNumeric(row[1])).forEach((row) => strings[row[0].getTime()] = row[1] + '');


				
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
						x :  {drawAxis : false, drawGrid: false, valueFormatter: (ms) => cast('time', ms)},
						y :  {drawAxis : false, drawGrid: false} 
					},
					labels: ['time', history.columns[idx + 1]],
					highlightCircleSize: 2,					
					drawPoints: true,
					stackedGraph: true,
					connectSeparatedPoints: true,
					drawPoints: true,
					drawPointCallback: function (g, seriesName, canvasContext, cx, cy, seriesColor, pointSize, row) {
						var time = g.getValue(row, 0);
						var status = alerts[time];
						if (status)	
							return drawCircle(canvasContext, cx, cy, getStatusColor(status), 2);

						if (strings[time])
							return drawCircle(canvasContext, cx, cy, '#000', 2);
						
					},
					legendFormatter: (data) => (data.x !== null && data.series && data.series[0].yHTML) ? data.xHTML + ': <b>' + data.series[0].yHTML + '</b>' : ''
				};
				graphs[id] = new Dygraph($e.get(0), data, opts);
				graphs[id].alerts = alerts;
				graphs[id].strings = strings;
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

	$app.on('status-updated', function (event, packet) {
		$app.find('#diagram').attr('updated', 'Updated: ' + cast('datetime', packet.time || new Date().getTime()));
		var $element_list = $elements[packet.id];
		if (!$element_list)
			return;

		$element_list
			.filter(($e) => $e.hasClass('device'))
			.forEach(($e) => $e.trigger('update-element', [{status: packet.status}, packet.time]));
	});

	$app.on('values-updated', function (event, packet) {
		$app.find('#diagram').attr('updated', 'Updated: ' + cast('datetime', packet.time || new Date().getTime()));
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

		var text = cast('time', alert.time) + ' ' + alert.path + ': ' + alert.description;
		var $li = $('<li/>')
			.attr('id', alert.id)	
			.attr('device-id', alert.device_id)
			.attr('status', alert.status)
			.attr('time', alert.time)
			.addClass('alert')	
			.html(text)
			.attr('title', text);

		if (!!alert.is_hidden)			
			$li.attr('is-hidden', true);

		$li.appendTo($alert_list);	
	});

	$app.on('click', '#page-close', function() {
		$elements = {};
		links = {};
		$page.empty();
		$diagram_list.find('li.active').removeClass('active');
	});

	$app.on('click', '.element[diagram-id]', function() {
		$e = $diagram_list.find('li#' + this.getAttribute('diagram-id'));
		if (!$e.hasClass('active'))
			$e.trigger('click');
	});

	// :(
	$app.on('click', '.element[device-id]', function() {
		$(window).trigger('toggle-app');
		$e = $('#app-device #device-list li#' + this.getAttribute('device-id'));
		if (!$e.hasClass('active'))
			$e.trigger('click');
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
		var ids = $components.find('select[store]')
			.map((i, e) => e.getAttribute('store')).get()
			.filter((e, i, arr) => arr.indexOf(e) == i);

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

			var shift = type == 'link' ? 5 : 0;
			return $.extend(obj, {
				id: e.id,
				type: type,
				width: $e.width(),
				height: $e.height(),
				x: $e.position().left + shift,
				y: $e.position().top + shift	
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
		$page.siblings('#page-close').trigger('click');
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
		$editor.trigger('add-element', [$.extend(true, {}, data), true]);
	});

	$('body').on('keydown', function (event) {
		// Del: Remove current
		if (event.keyCode == 46 && $editor) {	 
			$editor.find('.element[current]').remove();
		}
	});	
	
	$page.on('update-canvas', '#page-diagram-edit #diagram', function (event, newlink) {
		var canvas = $editor.find('#canvas').get(0);
		var ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		var size = $editor.find('#grid-size').val() || 20;
		ctx.strokeStyle = '#eee';
		ctx.lineWidth = 1;

		ctx.beginPath();
		for (var i = 0; i <= canvas.height / size ; i++) {
			ctx.moveTo(0.5, i * size + 0.5);
			ctx.lineTo(canvas.width + 0.5, i * size + 0.5); 
		}
		for (var i = 0; i <= canvas.width / size; i++) {
			ctx.moveTo(i * size + 0.5, 0 + 0.5);
			ctx.lineTo(i * size + 0.5, canvas.height + 0.5); 
		}
	    ctx.stroke();
		
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

	$page.on('change', '#grid-size', () => $editor.trigger('update-canvas'));

	$page.on('add-element', '#page-diagram-edit #diagram', function (event, data, current) {
		if (!data || !data.id)
			return console.error('Incorrect request to create object', data);

		//console.log('ADD', data);
		var shift = data.type == 'link' ? 5 : 0;
		var $e = $('<div/>')
			.attr('id', data.id)
			.attr('parent-id', data['parent-id'])
			.attr('type', data.type)
			.attr('title', data.type)
			.addClass('element')
			.addClass(data.type)
			.css({
				left: nvl(data.x, 100) - shift, 
				top: nvl(data.y, 100) - shift,
				width: data.width || data.type != 'link' && 100 || 10, 
				height: data.height  || data.type != 'link' && 100 || 10
			})
			.data('props', data)
			.appendTo($editor);

		$('<div/>').attr('id', 'remove').addClass('icon icon-remove').appendTo($e);
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
		$.each(props, function (prop, value) {
			var $prop = $e.find('#props #' + prop);
			if ($prop.is('input[type="checkbox"]'))
				$prop[0].checked = !!value;
			else
				$prop.val(value);

			$prop.trigger('change', [true, props['varbind-id']])
		});

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

		var click = $editor.data('click'); 
		if (click.x == event.offsetX && click.y == event.offsetY) // Fix: Chrome mousedown + mousemove bug
			return;

		var size = event.ctrlKey ? 1 : $editor.find('#grid-size').val();
		if (mode == 'move') {
			var offset = $editor.offset();
			var shift = $e.hasClass('link') ? 5 : 0;
			$e.offset({left: round(event.pageX - click.x - offset.left, size) + offset.left - shift, top: round(event.pageY - click.y - offset.top, size) + offset.top - shift});
			if ($e.find('#link-add').length || $e.hasClass('link'))
				$editor.trigger('update-canvas');
		}

		if (mode == 'resize') {
			$e.css({width: round(event.clientX - $e.offset().left, size), height: round(event.clientY - $e.offset().top, size)});
			$editor.trigger('update-canvas');
		}		
	});


	$page.on('mouseup', '#page-diagram-edit #diagram', function (event) {
		var click = $editor.data('click');
		var is_click = click && click.x == event.offsetX && click.y == event.offsetY;
		var current = $editor.attr('current');
		var id = $editor.find('.element[current]').attr('id');

		$editor.trigger('set-current', [is_click && current != id || !is_click && current == id ? current : null, '']);
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
		$(this).closest('.element').attr('label', (this.value || '').split(';')[0]);
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
		props[this.id] = this.type == 'checkbox' ? +this.checked || 0: this.value;
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