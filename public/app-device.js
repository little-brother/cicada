	var graphs = {device: {}, dashboard:{}};
$(function(){
	var $app = $('#app-device').height(window.innerHeight);
	var $page = $app.find('#page');
	var $device_list = $app.find('#navigator #device-list');
	var $dashboard = $app.find('#dashboard');
	var $device_tag_list = $app.find('#navigator #device-tag-list');
	var $varbind_tag_list = $app.find('#dashboard #varbind-tag-list');
	var $components = $('#components');


	var templates = {};

	// INIT
	$app.splitter({limit: 200, onDragEnd});

	var is_admin = getCookie('access') == 'edit';
	if (is_admin) {
		updateTemplates();
		updateProtocolComponents();
		updateConditions();
	} else {
		$components.find('#page-alert-list-view #alert-list #td-hide').remove();
	}

	$.ajax({
		method: 'GET',
		url: '/device',
		dataType: 'json',
		success: function (devices) {
			devices.forEach(updateNavigatorDevice);
			setHistoryPeriodSelector($dashboard);
			updateNavigatorStatus();
			updateTags();

			var path = window.location.pathname || '';
			if (path.indexOf('/device/') == 0) {
				var device_id = parseInt(path.substring(8));
				$device_list.find('#' + device_id).trigger('click');
			}
			if (path == '/alert')
				$app.find('#navigator #alert-block').trigger('click');

			window.history.replaceState(null, null, '/');
		}
	});

	// VIEW 
	$app.on('click', '#page-close', showDashboard);

	$app.on('click', '#page-close, .device-add, #device-scan, #navigator #alert-block, #check-list-edit', function() {
		$device_list.find('li.active').removeClass('active');
		$app.trigger('notify', {device_id: 0});
	});

	$app.on('click', '#device-list li', function(e, data) {
		$dashboard.attr('hidden', true);

		var $e = $(this);
		if ($e.hasClass('active') && !!e.originalEvent) {
			showDashboard();
			$app.trigger('notify', {device_id: 0});
			return $e.removeClass('active');
		}

		$page.empty();

		var device_id = parseInt($e.attr('id')) || 0;	
		$app.trigger('notify', {device_id});

		$.ajax({
			method: 'GET',
			url: '/device/' + device_id + '/varbind-list',
			dataType: 'json',
			success: function(varbind_list) {
				$dashboard.removeAttr('hidden');
				
				var $component = $components.find('#page-device-view').clone();
				$component.find('.top-menu').find('#device-edit, #device-clone, #device-remove').attr('device-id', device_id);
				$component.appendTo($page);

				$device_list.find('li.active').removeClass('active');
				$device_list.find('li#' + device_id).addClass('active');

				if (!varbind_list.length)
					return $component.find('#page-content').html('There are no varbinds.');

				$selector = setHistoryPeriodSelector($component);

				var $varbind_list = $('<table/>').attr('id', 'varbind-list').attr('device-id', device_id).data('varbind-list', varbind_list);

				var collator = new Intl.Collator();
				varbind_list.sort(function(a, b) {
					if (a.is_history && !b.is_history)
						return 1;
					if (!a.is_history && b.is_history)
						return -1;
					
					return collator.compare(a.name, b.name);
				});

				varbind_list.forEach(function (varbind, i) {
					$('<tr/>')
						.attr('id', varbind.id)
						.append($('<td id = "td-name"/>').html(varbind.name))
						.append($('<td id = "td-value"/>').text(cast(varbind.value_type, varbind.value)).attr('title', cast(varbind.value_type, varbind.value)).attr('status', varbind.status))
						.append($('<td id = "td-history"/>').attr('value-type', varbind.value_type))
						.appendTo($varbind_list);
				});
				$varbind_list.appendTo($component.find('#page-content'));

				if (data && data.period)
					return $selector.pickmeup('set_date', [new Date(data.period[0]), new Date(data.period[1])]).attr('changed', true).pickmeup('hide');

				$varbind_list.trigger('update-device');
			}
		});
	});

	$app.on('filter-device-list', function() {
		var tag_list = $device_tag_list.find('[checked]').map((i, e) => e.id).get();

		$device_list.find('li').each(function (i, e) {
			var $e = $(e);
			var has_tag = tag_list[0] == 'All' || !!($e.data('tag-list') || []).filter((e) => tag_list.indexOf(e) != -1).length;
			return (has_tag) ? $e.removeAttr('is-hidden') : $e.attr('is-hidden', true);
		})
	});

	$page.on('update-device', '#page-device-view #varbind-list', function (event, data) {
		var $varbind_list = $(this);
		var varbind_list = $varbind_list.data('varbind-list');
		var from = data && data.period && data.period[0]; 
		var to = data && data.period && (data.period[1] + 24 * 3600 * 1000 - 1);

		var $cells = {};
		varbind_list.forEach(function (varbind) {
			$cells[varbind.id] = $varbind_list.find('tr#' + varbind.id + ' #td-history').empty().attr('is-history', varbind.is_history);
			if (!varbind.is_history)
				$('<table/>').appendTo($cells[varbind.id]);
		});

		function onHistoryData(res) {
			deleteGraph('device');
		
			$.each(varbind_list.filter((varbind) => varbind.is_history), function(i, varbind) {
				var idx = res.ids.indexOf(varbind.id);
				if (idx == -1)
					return;

				var data = res.rows.map((row) => [new Date(row[0]), row[idx + 1]]).filter((row) => !!row[1] || row[1] === 0) || [];

				var alerts = res.alerts[varbind.id] || {};
				var strings = {};
				data.filter((row) => !$.isNumeric(row[1])).forEach((row) => strings[row[0].getTime()] = row[1] + '');
				normalizeHistory(data);

				if (data.length == 0)
					data = [[new Date(), parseFloat(varbind.value) || 0]]; // fake data to create graph

				var opts = {
					animatedZooms: true,
					labels: ['time', 'value'],
					highlightCircleSize: 2,					
					height: 116,
					axes: {
						x: {valueFormatter: (ms) => cast('datetime', ms)},
						y: {valueFormatter: (val, opts, seriesName, g, row) => strings[g.getValue(row, 0)] || cast(varbind.value_type, val)}
					},
					verticalCrosshair: true,
					stackedGraph: true,
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

				if (res.downsampled) {
					opts.zoomCallback = function (minDate, maxDate, yRange) {
						var g = this;
						if (minDate == g.rawData_[0][0] && maxDate == g.rawData_[g.rawData_.length - 1][0]) // Unzoom
							return; 

						clearTimeout(updateHistoryTimer);
						updateHistoryTimer = setTimeout(getHistory, 200, minDate, maxDate, (sub) => onZoom(sub, minDate, maxDate));	
					};
				}
			
				graphs.device[varbind.id] = new Dygraph($cells[varbind.id].get(0), data, opts);
				graphs.device[varbind.id].alerts = alerts;
				graphs.device[varbind.id].strings = strings;
			})
			
			Dygraph.synchronize(varbind_list.map((v) => graphs.device[v.id]).filter((g) => !!g));
		}

		var updateHistoryTimer;
		function onZoom(sub, minDate, maxDate) {
			$.each(varbind_list.filter((varbind) => varbind.is_history), function(i, varbind) {
				var idx = sub.ids.indexOf(varbind.id);
				var g = graphs.device[varbind.id];
				if (idx == -1 || !g)
					return;

				if (sub.rows.length == 0)				
					return;

				var rows = sub.rows.map((row) => [row[0], row[idx + 1]]).filter((row) => !!row[1] || row[1] === 0);
				normalizeHistory(rows);

				var data = [].concat(g.rawData_.filter((r) => r[0] < minDate), rows, g.rawData_.filter((r) => r[0] > maxDate));
				data.forEach((row) => row[0] = new Date(row[0]));
				g.updateOptions({file: data});
			});
		}

		function getHistory(from, to, callback) {
			$.ajax({
				method: 'GET',
				url: '/device/' + $varbind_list.attr('device-id') + '/varbind-history',
				data: {
					from: parseInt(from), 
					to: parseInt(to), 
					downsample: 'auto'
				},	
				success: callback,
				complete: () => $app.find('#device-history-period').pickmeup('set_date', new Date())
			});
		}

		getHistory(from, to, onHistoryData);
			
		$.ajax({
			method: 'GET',
			url: '/device/' + $varbind_list.attr('device-id') + '/varbind-changes',
			data: {from, to},	
			success: function (res) { 
				if (!res.length)
					return;

				var changes = {};
				res.forEach(function(row) {
					var varbind_id = row[2];
					if (!changes[varbind_id])
						changes[varbind_id]	= [];

					changes[varbind_id].push({from: row[0], to: row[1], prev_value: row[3], value: row[4], status: row[5]});
				});
	
				for (var varbind_id in changes) {
					var history = changes[varbind_id];
					var value_type = varbind_list.find((varbind) => varbind_id == varbind.id).value_type; 
					history.sort((a, b) => a.from - b.from);
					var $table = $cells[varbind_id].find('table');
					history.forEach((row) => createHistoryTableRow(row, value_type).appendTo($table));
				}
			}
		});
	});

	// EDIT
	$page.on('click', '.top-menu #device-edit, .top-menu #device-clone', function() {
		var $e = $(this);	
		$.ajax({
			method: 'GET',
			url: '/device/' + $e.attr('device-id'),
			success: (device) => setDevice(device, this.id == 'device-clone')
		});
	});

	$app.on('click', '.top-menu .device-add', function() {
		var $e = $(this);
		var template_name = $e.attr('name');

		if (!!template_name && !templates[template_name])
			return updateTemplateInfo(template_name, () => $e.trigger('click'));

		setDevice(templates[template_name] || {is_pinged: 1});			
	});

	$page.on('focus', '#page-device-edit #tags', function () {
		$(this).attr('focused', true);
	}); 

	$page.on('blur', '#page-device-edit #tags', function () {
		var $e = $(this);
		setTimeout(() => $e.is(':focus') ? null : $e.removeAttr('focused'), 100);
	});

	$page.on('click', '#page-device-edit #tag-list span', function() {
		var $e = $(this).closest('td').find('input').focus();
		$e.val() ? $e.val($e.val() + ';' + this.innerHTML) : $e.val(this.innerHTML);
	});

	function setDevice(device, cloned) {
		$page.empty();
		var $component = $components.find('#page-device-edit').clone(true, true);
		$component.find('#device-save-cancel').attr('back', device.id);

		if (cloned) {
			delete device.id;
			device.name += ' clone';
		}

		$component.find('#id').val(device.id);
		$component.find('#name').val(device.name);
		$component.find('#ip').val(device.ip);
		$component.find('#mac').val(device.mac);
		$component.find('#period').val(device.period || 60);
		$component.find('#timeout').val(device.timeout || 3);
		$component.find('#description').val(device.description);
		$component.find('#is-pinged')[device.is_pinged ? 'attr' : 'removeAttr']('checked', true);
		$component.find('#check-parent-at-failure')[!!device.parent_id ? 'attr' : 'removeAttr']('checked', true);
		$component.find('#force-status-to').val(device.force_status_to || 3);
		$component.find('#tags').val(device.tags);

		for (var protocol in device.protocols || {}) {
			$component
				.find('#protocols #page-' + protocol)
				.find('input, select')
				.each((i, e) => $(e).val(device.protocols[protocol] && device.protocols[protocol][e.id]));
		}
		
		var $vb_table = $components.find('#partial-varbind-list-edit .varbind-list');
		$component.find('#protocols div[id^="page-"]').each(function(i, e) {
			var $e = $(e);
			var protocol = e.id.substring(5);
			var $varbind_list = $e.find('.varbind-list').attr('protocol', protocol);
			var $template_row = $varbind_list.find('#template-row');
			buildConditionList($template_row.find('#td-condition'));
			
			(device.varbind_list || []).forEach(function (varbind, i) {
				if (varbind.protocol != protocol)
					return;

				var $row = $template_row.clone(true, true).removeAttr('id');
				$row.attr('id', varbind.id);
				$row.find('#name').val(varbind.name);

				var $td_address = $row.find('#td-address');
				$.each(varbind.address || {}, (key, value) => $td_address.find('#' + key).val(value).attr('value', value).closest('tr').attr('value', value));
				
				$row.find('#divider').val(varbind.divider || 1);
				$row.find('#value-type').val(varbind.value_type || 'string');
				var cid = varbind.condition_id || varbind.condition && $row.find('#td-condition option[name="' + varbind.condition + '"]').attr('value') || 0;
				$row.find('#td-condition').attr('condition-id', cid).find('#condition-list').val(cid);
				$row.find('#tags').val(varbind.tags);

				if (varbind.check_id) {
					$row.attr('check-id', varbind.check_id);	
					$row.find('input, select, textarea').attr('readonly', true);
					$row.attr('title', 'Group check. Use Ctrl + Shift + C to edit');	
				}
				$row.appendTo($varbind_list);
			});
		});
		$component.appendTo($page);	

		var $menu = $component.find('#protocol-menu');
		$component.find('.varbind-list tbody:has(tr)').each((i, e) => $menu.find('div[protocol="' + $(e).closest('table').attr('protocol') + '"]').trigger('click'));
		$component.find('#protocols label:visible:first').trigger('click');
		updateProtocolTabsState();
	}

	function getDevice() {
		var $props = $page.find('#page-content #properties');
		var $protocols = $page.find('#page-content #protocols'); 

		var device = {
			id: parseInt($props.find('#id').val()),
			name: trim($props.find('#name').val()),
			description: trim($props.find('#description').val()),
			ip: trim($props.find('#ip').val()),
			period: parseInt($props.find('#period').val()),
			timeout: parseInt($props.find('#timeout').val()),
			mac: trim($props.find('#mac').val()),
			tags: trim($props.find('#tags').val()),
			is_pinged: $props.find('#is-pinged:checked').length,
			parent_id: $props.find('#check-parent-at-failure:checked').length,
			force_status_to:  trim($props.find('#force-status-to').val()),
			protocols: {},
			varbind_list: []
		};

		if (!device.id)
			delete device.id;	

		$protocols.find('input:radio[name="tab"]')
			.map((i, e) => e.id.substring(4)) // tab-{protocol}
			.filter((i, protocol) => $protocols.find('#page-' + protocol + ' .varbind-list tbody').has('tr').length)
			.each(function(i, protocol) {
				var params = {};
				$protocols.find('#page-' + protocol + ' #protocol-params')
					.find('input, select, textarea')
					.each((i, param) => params[param.id] = trim(param.value));
				device.protocols[protocol] = params;
			});

		$page.find('.varbind-list').each(function(i, e) {
			$varbind_list = $(e);
			var protocol = $varbind_list.attr('protocol');
			$varbind_list.find('tbody tr').each(function(j, row) {
				var $row = $(row);
				if ($row.attr('check-id'))
					return;

				var varbind = {
					protocol: trim(protocol),
					id: parseInt($row.attr('id')),
					name: trim($row.find('#name').val()),
					address: {},
					divider: trim($row.find('#divider').val()),
					value_type: $row.find('#value-type').val(),
					condition_id: $row.find('#condition-list').val(),
					tags: trim($row.find('#tags').val()),
					check_id: $row.attr('check-id')
				}
				$row.find('#td-address').find('input, select, textarea').each((i, e) => varbind.address[e.id] = trim(e.value));
			
				device.varbind_list.push(varbind);
			})
		})

		return device;		
	}

	function jsonDevice(device) {
		var stringify = (obj, prop) => (obj['json_' + prop] = JSON.stringify(obj[prop])) && delete obj[prop];
		
		if (!device.varbind_list)	
			device.varbind_list = [];
		device.varbind_list.forEach((varbind) => stringify(varbind, 'address'));
		stringify(device, 'varbind_list');	
		stringify(device, 'protocols');

		return device;
	}

	$page.on('click', '.top-menu #device-save', function() {
		var device = getDevice();
		jsonDevice(device);

		$.ajax({
			method: 'POST',
			url: '/device',
			data: device,
			dataType: 'text',
			success: function (id) {
				device.id = id;
				updateNavigatorDevice(device).click();
				updateNavigatorStatus(); 
				updateTags();
				$app.trigger('filter-device-list');
			}
		})
	});

	$page.on('click', '.top-menu #device-save-cancel', function() {
		var id = this.getAttribute('back') || 0;
		var $e = $device_list.find('li#' + id);

		return ($e.length > 0) ? $e.click() : showDashboard();
	});

	$page.on('click', '#page-device-edit #template-save', function() {
		var device = getDevice();
		var name = device.name;
		if (!name)
			return alert('The name is empty');

		if (templates[name] != undefined && !confirm('Overwrite?'))
			return;

		['id', 'name', 'ip', 'mac'].forEach((prop) => delete device[prop]);

		var conditions = getConditions();
		device.varbind_list.forEach(function (varbind) {
			varbind.condition = conditions[varbind.condition_id] || '';
			delete varbind.id;
			delete varbind.condition_id;		
		});

		$.ajax({
			method: 'POST',
			url: '/template/' + name,
			data: {
				template: JSON.stringify(device, 1, '\t')
			},
			success: function (res) {
				templates[name] = false;
				alert('Saved');
			},
			complete: updateTemplates
		});
	});

	$app.on('click', '#navigator #template-remove', function(event) {
		event.stopPropagation();

		var $e = $(this).closest('div[name]');
		var name = $e.attr('name');
		$.ajax({
			method: 'DELETE',
			url: '/template/' + name,
			success: function () {
				$e.remove();
				delete templates[name]; 
			},
			complete: updateTemplates
		});
	});

	$app.on('click', '.top-menu #template-list #import', function() {
		$app.find('#import-upload').click();
	});

	$app.on('change', '#import-upload', function (event) {
		var $import = $(this);
		var device_list = [];
		var $condition_list = $components.find('#partial-varbind-condition-list #condition-list');	

		function importDevice (device_no) {
			if (device_no == device_list.length) { 
				$import.val('');
				$app.trigger('filter-device-list');
				updateNavigatorStatus(); 
				updateTags();
				return;
			}

			var device = device_list[device_no];
			if (!(device instanceof Object) || !device.name) {
				console.error('Bad import format: ' + JSON.stringify(device));
				importDevice(device_no + 1);
				return;	
			}
			
			if (device.template && templates[device.template] === false)
				return updateTemplateInfo(device.template, () => importDevice(device_no));

			if (device.template && templates[device.template])
				device = $.extend(true, {}, templates[device.template], device); 

			delete device.id;	
			if (!device.varbind_list)
				device.varbind_list = [];

			device.varbind_list.forEach((v) => v.condition_id = $condition_list.find('[name="' + v.condition + '"]').attr('value') || 0);
			jsonDevice(device);

			$.ajax({
				method: 'POST',
				url: '/device',
				data: device,
				success: function (id) {
					device.id = id;
					updateNavigatorDevice(device);
					importDevice(device_no + 1);
				},
				error: function (err) {
					console.error(device.name, err.message);
					importDevice(device_no + 1);
				}
			});
		}

		function onLoad () {
			try {
				device_list = JSON.parse(reader.result) || [];
			} catch (err) {
				return alert('Error parse file: ' + err.message);
			}

			if (!(device_list instanceof Array))
				device_list = [device_list];

			importDevice(0);
		}

		var file = event.target.files[0];           
		var reader = new FileReader();
		reader.onload = onLoad;
		reader.onerror = (err) => console.error(err);
		reader.readAsText(file);
	});

	$page.on('click', '#page-device-edit .varbind-list #varbind-add', function() {
		var $table = $(this).closest('.varbind-list');
		$table.find('#template-row').clone()
			.removeAttr('id')
			.appendTo($table.find('tbody'))
			.find('input:text').each((i, e) => e.value = e.getAttribute('value'));
		updateProtocolTabsState();
	});

	$page.on('click', '#page-device-edit #varbind-discovery .content div', function() {
		var $tab = $(this).closest('[id^="page-"]');
		var $varbind_list = $tab.find('table.varbind-list');
		var data = {
			rule: this.id,
			protocol: $varbind_list.attr('protocol'),
			ip: $page.find('#ip').val()
		}
		$tab.find('#protocol-params').find('input, select').each((i, param) => data[param.id] = param.value);

		$.ajax({
			method: 'GET',
			url: '/discovery',
			data: {
				json_opts: JSON.stringify(data)
			},
			success: function (varbind_list) {
				if (!varbind_list.length)
					return alert('No matches were found');

				var $template_row = $varbind_list.find('#template-row');
				varbind_list.forEach(function (varbind) {
					var $row = $template_row.clone(true, true).removeAttr('id');
					$row.find('#name').val(varbind.name);
	
					var $td_address = $row.find('#td-address');
					$.each(varbind.address || {}, (key, value) => $td_address.find('#' + key).val(value).attr('value', value));
					
					$row.find('#divider').val(varbind.divider || 1);
					$row.find('#value-type').val(varbind.value_type || 'string');
					$row.find('#td-value').html(cast(varbind.value_type, varbind.value));
					var cid = varbind.condition_id || varbind.condition && $row.find('#td-condition option[name="' + varbind.condition + '"]').attr('value') || 0;
					$row.find('#td-condition').attr('condition-id', cid).find('#condition-list').val(cid);
					$row.find('#tags').val(varbind.tags);
					$row.appendTo($varbind_list);
					updateProtocolTabsState();
				});
			}
		})
	});


	$page.on('click', '#page-device-edit .varbind-list #varbind-remove', function() {
		$(this).closest('tr').remove();
		updateProtocolTabsState();	
	});

	$page.on('click', '#page-check-list-edit .varbind-list #check-remove', function() {
		$(this).closest('tr').remove();
	});

	$page.on('change', '.varbind-list #if', function() {
		$(this).attr('if', this.value);
	});

	$page.on('change', '#page-device-edit .varbind-list input', function() {
		$(this).closest('table.varbind-list').attr('changed', true);
	});

	$page.on('change', '#page-device-edit #condition-list, #page-check-list-edit #condition-list', function() {
		var $td = $(this).closest('td');	
		$td.attr('condition-id', this.value);

		if (this.value == '') { // New...
			var $block = $components.find('#partial-varbind-condition-block').clone();
			$td.empty().append($block.children());
			$td.attr('edit', true);				
		}
	});

	$page.on('click', '#page-device-edit #condition-edit, #page-check-list-edit #condition-edit', function() {
		var $td = $(this).closest('td');
		var $block = $components.find('#partial-varbind-condition-block').clone();
		$td.empty().append($block.children());
		$td.attr('edit', true);

		var $list = $td.find('.condition-list');
		var $template_row = $components.find('#partial-varbind-condition');
		$.ajax({
			method: 'GET',
			url: '/condition/' + $td.attr('condition-id'),
			dataType: 'json',
			success: function (condition) {
				$td.find('#name').val(condition.name);
				$td.find('#gap').val(condition.gap || 0);
				condition.condition_list.forEach(function (condition) {
					var $row = $template_row.clone().removeAttr('id');
					$row.find('#if').val(condition.if).attr('if', condition.if);
					$row.find('#value').val(condition.value);
					$row.find('#status').val(condition.status);
					$row.appendTo($list);
				})
			}
		});
	});

	$page.on('click', '#page-device-edit #td-condition[edit] #cancel, #page-check-list-edit #td-condition[edit] #cancel', function(event) {
		var $td = $(this).closest('td').removeAttr('edit');
		buildConditionList($td, $td.attr('condition-id') || 0);
	});	

	$page.on('click', '#page-device-edit #td-condition[edit] #save, #page-check-list-edit #td-condition[edit] #save', function(event) {
		var $td = $(this).closest('td');
		var condition_list = [];	
		$td.find('.condition').each(function (i, e) {
			var $cond = $(e);	
			condition_list.push({
				if: $cond.find('#if').val(),
				value: trim($cond.find('#value').val()),
				status: $cond.find('#status').val()
			});
		});

		var data = {
			id: $td.attr('condition-id'),
			name: $td.find('#name').val(),
			gap: $td.find('#gap').val(),
			json_condition_list: JSON.stringify(condition_list)
		}

		$.ajax({
			method: 'POST',
			url: '/condition',
			data,
			dataType: 'text',
			success: function (id) {
				$td.attr('condition-id', id).removeAttr('edit');
				var $condition_list = $components.find('#partial-varbind-condition-list #condition-list');
				var $option = $condition_list.find('[value="' + id+'"]');
				if (!$option.length || $option.length && $option.html() != data.name) {
					$option.remove();	
					$('<option/>').attr('value', id).html(data.name).appendTo($condition_list);

					$page.find('.varbind-list #td-condition').each((i, e) => buildConditionList($(e), e.getAttribute('condition-id')));
				} else {
					buildConditionList($td, id);
				}
			}
		})
	});

	function buildConditionList($td, id) {
		$td.empty();
		var $condition_block = $components.find('#partial-varbind-condition-list').clone(true, true);
		$condition_block.find('#condition-list').val(id || 0);
		$td.append($condition_block.children()).attr('condition-id', id || 0);
	}

	$page.on('click', '#page-device-edit #td-condition #add, #page-check-list-edit #td-condition #add', function() {
		$components.find('#partial-varbind-condition').clone().removeAttr('id').appendTo($(this).parent().find('.condition-list'));
	});

	$page.on('click', '#page-device-edit #condition-remove, #page-check-list-edit #condition-remove', function() {
		$(this).parent().remove();
	});

	$page.on('click', '#page-device-edit .varbind-list #td-value', function() {
		var $row = $(this).closest('tr');
		var data = {
			device_id: $row.closest('#page-content').find('#properties #id').val(),
			protocol: $row.closest('table').attr('protocol'),
			protocol_params: {ip: $page.find('#ip').val()},
			address: {},
			divider: $row.find('#divider').val()
		}
		$row.closest('div[id^="page-"]').find('#protocol-params').find('input, select').each((i, param) => data.protocol_params[param.id] = param.value);
		$row.find('#td-address').find('input:visible, select:visible, textarea:visible').each((i, param) => data.address[param.id] = param.value);
	
		$.ajax({
			method: 'GET',
			url: '/value',
			data: {
				json_opts: JSON.stringify(data)
			},
			dataType: 'text',
			success: function(res) {
				var value = cast($row.find('#value-type').val(), res);
				$row.find('#td-value').text(value).attr('title', value);
			}
		})
	});

	$page.on('click', '#page-device-edit .tabs #protocol-list div', function () {
		var $e = $(this);
		var protocol = $e.attr('protocol');
		var $tabs = $page.find('#page-device-edit .tabs');
		$tabs.children('label[for="tab-' + protocol + '"], div[id="page-' + protocol + '"], input[id="tab-' + protocol + '"]').toggleClass('hidden');
		$tabs.children('label[for="tab-' + protocol + '"]').trigger('click');
		$e.hide();
	});

	$page.on('click', '#page-device-edit .tabs label .remove', function () {
		var $e = $(this);
		var protocol = $e.attr('protocol');
		var $tabs = $page.find('#page-device-edit .tabs');
		$tabs.children('label[for="tab-' + protocol + '"], div[id="page-' + protocol + '"], input[id="tab-' + protocol + '"]').toggleClass('hidden');		
		$tabs.children('div[id="page-' + protocol + '"]').find('.varbind-list tbody').empty();
		$tabs.children('.dropdown-click').find('#protocol-list div[protocol="' + protocol + '"]').show();
		setTimeout(() => $tabs.children('label:not(.hidden)').trigger('click'), 10);
	});

	$page.on('click', 'details', function() {
		var $e = $(this);
		if ($e.find('div').html() || !$e.attr('url'))
			return;
		
		$.ajax({
			method: 'GET',
			url: $e.attr('url'),
			success: (res) => $e.find('div').html(res)
		})	
	});

	$page.on('click', '#page-device-view #device-remove', function() {
		var id = $(this).attr('device-id');
		$.ajax({
			method: 'DELETE',
			url: '/device/' + id,
			success: function() {
				$device_list.find('#' + id).remove();
				$page.empty();
				updateTags();
			}
		})
	});

	$app.on('click', '#check-list-edit', function () {
		$dashboard.attr('hidden', true);
		$page.empty();
			
		var $component = $components.find('#page-check-list-edit').clone(true, true);
		$component.appendTo($page);
	});

	$page.on('click', '.top-menu #check-save', function() {
		function getValues($e, stringify) {
			var res = {};
			$.each($e.find('input, select, textarea'), (i, e) => res[e.id] = trim(e.value));
			return (stringify) ? JSON.stringify(res) : res;		
		}		
		
		var check_list = $page.find('#check-list > tbody > tr').map(function (i, e) {
			var $row = $(this);

			var check = {
				id: $row.attr('id'),
				name: $row.find('#td-name #name').val(),
				include_tags: $row.find('#td-device-tags #include-tags').val(),
				exclude_tags: $row.find('#td-device-tags #exclude-tags').val(),
				protocol: $row.find('#td-protocol #protocol').val(),
				divider: $row.find('#td-divider #divider').val(),
				value_type: $row.find('#td-value-type #value-type').val(),
				condition_id: $row.find('#td-condition #condition-list').val(),
				tags: $row.find('#td-tags #tags').val()
			}  
			check.json_protocol_params = getValues($row.find('#td-protocol-params'), true);
			check.json_address = getValues($row.find('#td-address'), true);

			return check;
		}).get() || [];

		$.ajax({
			method: 'POST',
			url: '/check',
			data: {
				check_list: JSON.stringify(check_list)
			},	
			success: () => showDashboard()
		});
	});

	$page.on('click', '.top-menu #check-cancel', function() {
		$app.find('#page-close').trigger('click');
	});

	$app.on('click', '#navigator #alert-block', function() {
		if ($page.find('#alert-list').length) 
			return showDashboard();

		$page.empty();
		var $component = $components.find('#page-alert-list-view').clone(true, true);	

		$selector = setHistoryPeriodSelector($component);
		$component.appendTo($page);
		$component.find('#alert-list').trigger('update-alerts');
		$app.trigger('notify', {device_id: 0});		
	});

	$page.on('update-alerts', '#alert-list', function(event, data) {		
		var $e = $(this);
		var from = data && data.period && data.period[0]; 
		var to = data && data.period && (data.period[1] + 24 * 3600 * 1000 - 1);

		$.ajax({
			method: 'GET',
			url: '/alert',
			data: from && to ? {from, to} : undefined,
			dataType: 'json',
			success: function (alerts) {
				$e.find('tbody').empty();
				$.each(alerts, (i, alert) => addAlertListTableRow($e, alert));
				updateAlertList();
			}
		})
	});

	$page.on('click', '#alert-list #td-datetime, #alert-list #td-hint', function () {
		var $e = $(this).closest('tr');
		var time = roundTime($e.attr('time'));
		$device_list.find('li#' + $e.attr('device-id')).trigger('click', {period: [time, time]});
	});

	$page.on('click', '#alert-list #td-hide', function () {
		var $e = $(this).closest('tr');
		var $alert_list = $page.find('#alert-list');
		$.ajax({
			method: 'POST',
			url: '/alert/' + $e.attr('id') + '/hide',
			dataType: 'text',
			success: () => $alert_list.is('[period]') ? $e.attr('is-hidden', 1) : $e.remove()
		})
	});

	$page.on('click', '#alert-list .reject', function () {
		var $e = $(this).closest('tr');
		var $alert_list = $page.find('#alert-list');
		$.ajax({
			method: 'DELETE',
			url: '/alert/' + $e.attr('id'),
			dataType: 'text',
			success: () => $e.remove()
		})
	});

	$app.on('change', '#alert-list-filter input[type="checkbox"]', updateAlertList);
	$app.on('keyup', '#alert-list-filter input[type="text"]', updateAlertList);

	$app.on('click', '.top-menu #device-scan', function() {
		$page.empty();
		var $page_scan = $components.find('#page-device-scan').clone().appendTo($page);

		$page_scan.find('#range').focus();

		$template = $page_scan.find('#template-row select#template');
		$template.find('option:not([value=""])').remove();
		$.each(templates, (name) => $('<option/>').val(name).html(name).appendTo($template));
	});

	function toggleScanButton(start) {
		$start = $page.find('#device-scan-start').toggle(!start);
		$cancel = $page.find('#device-scan-cancel').toggle(start);
	}

	$page.on('keydown', '#page-device-scan #range', function (event) {
		$start = $page.find('#device-scan-start');
		if (event.keyCode == 13 && $start.is(':visible') === !$start.is(':hidden')) // Enter
			return $start.trigger('click');

		$cancel = $page.find('#device-scan-cancel');
		if (event.keyCode == 27 && $cancel.is(':visible') === !$cancel.is(':hidden')) // Esc
			return $cancel.trigger('click');
	});

	$page.on('click', '#page-device-scan #device-scan-cancel', function() {
		$.ajax({
			method: 'GET',
			url: '/scan/cancel',
			success: (res) => toggleScanButton(false)
		})
	});

	$page.on('click', '#page-device-scan #device-scan-start', function() {
		toggleScanButton(true);
		var $table = $page.find('#device-scan-result').hide();
		$.ajax({
			method: 'GET',
			url: '/scan',
			data: {
				range: $page.find('#range').val()
			},
			dataType: 'json',
			error: function(jqXHR, textStatus, errorThrown) {
				toggleScanButton(false);	
				console.error(jqXHR, textStatus, errorThrown);
				alert(jqXHR.responseText);
			},
			success: function (devices) {
				toggleScanButton(false);
				var $result = $table.find('tbody').empty();

				if (!$table.length || !devices.length)
					return;

				$table.show();
				$template_row = $table.find('#template-row');
				
				$.each(devices, function(i, device) {
					$row = $template_row.clone().removeAttr('id');
					$row.find('#name').val(device.name || ('Unknown #' + i));
					$row.find('#ip').val(device.ip);
					$row.find('#mac').val(device.mac);
					$row.find('#description').val(device.vendor);
					$row.appendTo($result);
				})
			}	
		})
	});

	$page.on('click', '#page-device-scan .add:not([all])', function(event, callback) {
		var $row = $(this).closest('tr');
	
		var template_name = $row.find('#template').val();
		var template = templates[template_name];
		if (template_name && !template)	
			return updateTemplateInfo(template_name, () => $(this).trigger('click'));
	
		var data = $.extend(true, {}, template || {}, {
			name: trim($row.find('#name').val()),
			ip: trim($row.find('#ip').val()),
			mac: trim($row.find('#mac').val()),
			is_pinged: $row.find('#is-pinged:checked').length,
			period: parseInt($row.find('#period').val()) || 60,
			tags: trim($row.find('#tags').val()),
			description: trim($row.find('#description').val()),
			json_varbind_list: JSON.stringify(template),
			template: trim(template_name)
		});

		$.ajax({
			method: 'POST',
			url: '/device',
			data: jsonDevice(data),
			success: function(id) {
				data.id = id;
				updateNavigatorDevice(data);
				$row.find('#td-add').addClass('icon icon-ok').html('');
				$device_list.find('li')
					.sort((a, b) => a.innerHTML.toLowerCase() > b.innerHTML.toLowerCase())
					.detach().appendTo($device_list);
				if (callback)
					callback();
			}
		})
	});

	$page.on('click', '#page-device-scan .add[all]', function() {
		var $devices = $(this).closest('table').find('tbody .add');
		if ($devices.length == 0)
			return;

		function addDevice(i) {
			if (i != $devices.length)
				$devices.eq(i).trigger('click', () => addDevice(i + 1))			
		}
		
		addDevice(0);
	});

	$page.on('click', '#page-check-list-edit #check-add', function() {
		var $table = $(this).closest('#check-list');
		$table.children('thead').children('#template-row').clone(true, true)
			.removeAttr('id')
			.appendTo($table.children('tbody'))
			.find('#td-protocol #protocol').trigger('change');
	});

	$device_tag_list.on('click', 'div', function(event) {
		if (this.hasAttribute('checked'))		
			return;

		this.setAttribute('checked', true);

		if (!event.ctrlKey) 
			$device_tag_list.find('div:not("#' + this.id + '")').removeAttr('checked');
		
		var $checked_list = $device_tag_list.find('[checked]:not(#All)');

		var $period = $dashboard.find('.history-period-block');
		$period.find('.history-period').val('').pickmeup('clear');
		$period.find('.history-period-value').html('Last hour');

		var prev_vt_list = $varbind_tag_list.find('input:checked').map((i, e) => e.id).get();

		var time = new Date();
		$varbind_tag_list.find('input:checked').removeAttr('checked');
		deleteGraph('dashboard');

		$(this).closest('.dropdown-click').find('.button').html(this.id != 'All' && $checked_list.map((i, e) => e.id).get().join(', ') || 'All');
			
		if (this.id == 'All' || $checked_list.length == 0) {
			$device_tag_list.find('div:not(#All)').removeAttr('checked');
			$device_tag_list.find('#All').attr('checked', true)
			$varbind_tag_list.find('input').each(function (i, e) {
				if (prev_vt_list.indexOf(e.id) != -1)
					$(e).attr('checked', true).prop('checked', true);
			});

			$varbind_tag_list.find('div').show();
			$dashboard.find('.history-period-block').attr('alert', true);	
		} else {
			$device_tag_list.find('#All').removeAttr('checked');		
			$varbind_tag_list.find('div').hide();
	
			$checked_list.each(function(i, e) {
				var tag_list = $(e).closest('div').data('tag-list') || [];
				tag_list.forEach(function (tag, i) {
					var id = tag.replace('/ /g', '-');
					var $e = $varbind_tag_list.find('#' + id);
					$e.closest('div').show();
					if (prev_vt_list.indexOf(id) != -1)
						$e.attr('checked', true).prop('checked', true);
				})
			});	
			$dashboard.find('.history-period-block').removeAttr('alert');
		}

		if ($varbind_tag_list.find('input[checked]').length == 0)
			$varbind_tag_list.children('div:visible:first').find('input').attr('checked', true).prop('checked', true);

		$app.trigger('filter-device-list');
		$dashboard.trigger('update-dashboard');
	});

	$varbind_tag_list.on('click', 'label', function(event) {
		var $e = $(this).prev();
		var tag = $e.attr('id');
		if (!event.ctrlKey) {
			$varbind_tag_list.find('input:checked:not(#' + tag + ')').removeAttr('checked');
			$e.prop('checked', false);
		} else {
			$e.prop('checked', !$e.prop('checked'));
			event.preventDefault();
		}

		var period = $dashboard.find('.history-period').pickmeup('get_date') || null;
		if (period && period.length > 0) 
			period = [period[0].getTime(), period[1].getTime()];

		setTimeout(() => $dashboard.trigger('update-dashboard', {period: period}), 10);
	});

	$dashboard.on('update-dashboard', function(event, event_data) {
		$dashboard.removeAttr('empty');
		event_data = event_data || {};
		if (event_data.update)
			deleteGraph('dashboard');

		var device_tag_list = $device_tag_list.find('[checked]').map((i ,e) => e.id).get().join(';');
		if ($varbind_tag_list.find('input:checked').length == 0) 
			$varbind_tag_list.children('div:visible:first').find('input').attr('checked', true).prop('checked', true);
		
		var varbind_tag_list = $varbind_tag_list.find('input:checked').map((i, e) => e.id).get();
		if (varbind_tag_list.length == 0)
			return $dashboard.attr('empty', true);

		var etag = varbind_tag_list.filter((tag) => !graphs.dashboard[tag])[0];

		if (!etag) {
			for (var tag in graphs.dashboard) {
				if (varbind_tag_list.indexOf(tag) == -1)
					deleteGraph('dashboard', tag);
			}

			var h = ($app.height() - $varbind_tag_list.height() - 80 - 20 * (varbind_tag_list.length - 1)) / varbind_tag_list.length;
			varbind_tag_list.forEach(function (tag) {
				
				var $block = $(graphs.dashboard[tag].graphDiv).parent();
				$block.height(h);
				$block.find('#summary-block').css('max-height', h - 50)
			});
			
			var $graphs = $dashboard.find('.graph').sort((a, b) => varbind_tag_list.indexOf(a.getAttribute('tag')) - varbind_tag_list.indexOf(b.getAttribute('tag')));
			$graphs.detach().appendTo($dashboard.find('#graph-block'));

			return window.dispatchEvent(new Event('resize'));
		}

		delete event_data.update;

		function onData(res) {
			var data = res.rows;
			if (!res.rows.length)
				res.rows.push(res.columns.map((e) => 0));

			res.uptime = res.ids.map(function (_, idx) {
				var downtime = 0;

				var is_down = false;				
				for (var i = 0; i < data.length - 1; i++) {
					var e = data[i][idx + 1];
					is_down = e == null ? is_down : !!isNaN(e);
					downtime += (+is_down) * (data[i + 1][0] - data[i][0]);
				}
					
				return 100 - Math.round(downtime / (res.period[1] - res.period[0]) * 100);
			});

			data.forEach((row) => row[0] = new Date(row[0]));

			if (etag == 'latency') {
				res.columns = res.columns.map((e) => e.substr(0, e.indexOf('/')));
				res.ids = res.device_ids;
			}

			var alerts = res.alerts;
			var strings = {};
			res.ids.forEach((id) => strings[id] = {});
		
			var length = data[0] && data[0].length || 0; 
			for (var i = 1; i < length; i++) {
				data.filter((row) => isNaN(row[i])).forEach((row) => strings[res.ids[i - 1]][row[0].getTime()] = row[i] + '');
				normalizeHistory(data, i);
			}

			var names = {};
			res.columns.forEach((name, i) => names[name] = res.ids && res.ids[i - 1]);

			var opts = {
				animatedZooms: true,
				labels: res.columns.slice(0, 11),
				highlightCircleSize: 2,					
				height: $app.height() - $varbind_tag_list.height() - 60,
				showLabelsOnHighlight: false,
				ylabel: etag,
				stackedGraph: false,
				axes: {
					x: {valueFormatter: (ms) => cast('datetime', ms)},
					y: {valueFormatter: function (val, opts, seriesName, g, row) {
							var varbind_id = names[seriesName];
							$summary.find('#' + varbind_id).find('#td-cur').html(strings[varbind_id] && strings[varbind_id][g.getValue(row, 0)] || val);
						}
					}
				},
				drawPoints: true,
				connectSeparatedPoints: true,
				drawPointCallback: function (g, seriesName, canvasContext, cx, cy, seriesColor, pointSize, row, idx) {
					var varbind_id = names[seriesName];
					var time = g.getValue(row, 0);

					var status = alerts[varbind_id] && res.alerts[varbind_id][time];
					if (status)	
						return drawCircle(canvasContext, cx, cy, getStatusColor(status), 2);

					if (strings[varbind_id] && strings[varbind_id][time])
						return drawCircle(canvasContext, cx, cy, '#000', 2);
				},
				highlightSeriesOpts: {strokeWidth: 2},
				highlightCallback: (event, x, points, row, seriesName) => $summary.find('tr').removeAttr('highlight').filter('tr#' + names[seriesName]).attr('highlight', true),
				unhighlightCallback: (event) => $summary.find('tr').removeAttr('highlight')
			};

			if (res.downsampled) {				
				opts.zoomCallback = function (minDate, maxDate, yRange)	{
					var g = this;
					if (minDate == g.rawData_[0][0] && maxDate == g.rawData_[g.rawData_.length - 1][0]) // Unzoom
						return; 

					$.ajax({
						method: 'GET',
						url: '/tag/' + etag,
						data: {
							tags: device_tag_list,
							from: minDate,
							to: maxDate,
							downsample: 'auto'
						},
						success: function (sub) {
							if (sub.rows.length == 0)
								return;

							var length = sub.rows[0].length;
							for (var i = 1; i < length; i++)
								normalizeHistory(sub.rows, i);

							sub.rows.forEach((row) => row[0] = new Date(row[0]));

							var min = new Date(minDate);
							var max = new Date(maxDate);
							g.source = [].concat(g.source.filter((r) => r[0] < min), sub.rows, g.source.filter((r) => r[0] > max));
							updateDashboardGraph(etag);
						}
					});					
				}	
			}

			var $div = $('<div/>').attr('tag', etag).addClass('graph').appendTo($dashboard.find('#graph-block'))
			var graph = new Dygraph($div.get(0), res.ids < 11 ? data : data.map((row) => row.slice(0, 11)), opts);
			graph.alerts = alerts;
			graph.strings = strings;
			graph.source = data;
			graphs.dashboard[etag] = graph;

			var $summary_block = $components.find('#partial-dashboard-summary').clone().attr('id', 'summary-block').css('max-height', $div.height() - 50);
			var $summary = $summary_block.find('#summary').attr('tag', etag);

			var $template_row = $summary.find('#template-row');
			var avg = (arr) => arr.reduce((sum, e) => sum + e, 0)/arr.length;
			var rnd = (num) => +num.toFixed(2);
			res.columns.slice(1).forEach(function(name, i) {
				var $row = $template_row.clone().attr('id', res.ids[i]).attr('idx', i + 1).attr('name', name);
				$row.find('#td-color').css('color', graph.colorsMap_[name]);
				$row.find('#td-name').html(name).attr('title', name).attr('device-id', res.device_ids[i]);
				
				var history = res.rows.map((row) => row[i + 1]).filter((e) => !isNaN(e));
				$row.find('#td-min').html(history.length > 0 ? rnd(Math.min.apply(Math, history)) : '-');
				$row.find('#td-avg').html(history.length > 0 ? rnd(avg(history)) : '-');
				$row.find('#td-max').html(history.length > 0 ? rnd(Math.max.apply(Math, history)) : '-');
				$row.find('#td-up').html(res.uptime[i]);
			
				$row.appendTo($summary);
			});

			if (res.ids.length > 10)
				$summary_block.find('#overflow').text('Shows top 10 of ' + res.ids.length);

			$summary_block.appendTo($div); // Important: append after dygraph creation
			$dashboard.trigger('update-dashboard', event_data); // ???
		}

		var now = new Date().getTime();	
		var period = event_data && event_data.period;

		$.ajax({
			method: 'GET',
			url: '/tag/' + etag,
			data: {
				tags: device_tag_list,
				from: period && period[0] ? period[0] : now - 60 * 60 * 1000,
				to: period && period[1] ? period[1] + 24 * 60 * 60 * 1000 - 1 : now,
				downsample: 'auto'
			},
			success: onData
		})
	});

	function updateDashboardGraph(tag) {
		var graph = graphs.dashboard[tag];
		if (!graph)
			return console.log('Graph not found');

		var $summary = $(graph.graphDiv).closest('.graph').find('#summary');
		if ($summary.find('tbody tr') <= 10)
			return console.log('Rows less then 10');

		var idxs = $summary.find('tbody tr:visible').map((i, e) => e.getAttribute('idx')).get();
		idxs.unshift(0); // time
		graph.updateOptions({
			labels: ['time'].concat($summary.find('tbody tr:visible #td-name').map((i, e) => e.innerHTML).get()),
			file: graph.source.map((row) => idxs.map((idx) => row[idx]))
		});
	}

	function showDashboard() {
		$dashboard.removeAttr('hidden');
		$page.empty();
		$dashboard.trigger('update-dashboard');
	}

	$dashboard.on('click', '#summary th.sortable', function () {
        var $td = $(this);
		var $table = $td.closest('table').find('tbody');
		var colno = $td.index(); 
		var order = $td.attr('order') || 1;

		$td.closest('tr').find('th').each((i, e) => e.removeAttribute('order'));
		$td.attr('order', -order);

		$table.children('tr')
			.sort((a, b) => order * (+$(a).find('td').eq(colno).html() - $(b).find('td').eq(colno).html()))
			.detach().appendTo($table);

		updateDashboardGraph($table.closest('.graph').attr('tag'));	
	});

	$dashboard.on('click', '#summary #td-name', function () {	
		$device_list.find('li#' + $(this).attr('device-id')).trigger('click');
	});	

	$dashboard.on('click', '#summary-block #export', function () {
		var delimiter = ';';
		var columns = ['name', 'min', 'avg', 'max', 'up'];
		
		var text = columns.join(delimiter) + '\n' +
			$(this).parent().find('#summary tbody tr')
				.map((i, e) => columns.map((c) => (e.querySelector('#td-' + c) || {}).innerHTML).join(delimiter))
				.get().join('\n');
			
		var uploader = window.document.createElement('a');
		uploader.href = URL.createObjectURL(new Blob([text], {type: 'text/csv'}));
		uploader.download = 'summary.csv';
		
		document.body.appendChild(uploader);
		uploader.click();
		uploader.remove();
	});

	function deleteGraph(where, id) {
		if (!graphs[where])
			return;
	
		(id ? [id] : Object.keys(graphs[where])).forEach(function (id) {
			try {
				graphs[where][id].graphDiv.parentNode.remove();
				graphs[where][id].destroy();
			} catch (err) {}
			delete graphs[where][id];
		});

		// fix if handlers are lost
		if (where == 'dashboard' && !id)
			$dashboard.find('#graph-block').empty(); 
	}

	function updateTags () {
		deleteGraph('dashboard');
		$dashboard.find('.history-period').val('').pickmeup('clear');
		
		function addTag($target, tag, data) {
			var id = tag.replace(/ /g, '-');

			$('<div/>')
				.attr('tags', data)
				.data('tag-list', data)
				.append($('<input type = "checkbox" autocomplete = "off"/>').attr('id', id))
				.append($('<label>').attr('for', id).html(tag))
				.appendTo($target);
		}

		$.ajax({
			method: 'GET',
			url: '/tags',
			success: function(tags) {
				var prev_checked_list = $device_tag_list.find('[checked]').map((i, e) => e.id).get();
				if (prev_checked_list.length == 0)
					prev_checked_list = ['All'];

				device_counts = {'All': $device_list.find('li').length};
				$device_list.find('li').each(function(i, e) {
					$(e).data('tag-list').forEach((tag) => !device_counts[tag] ? device_counts[tag] = 1 : device_counts[tag]++)
				})
			
				$device_tag_list.empty();
				$.each(tags, function (tag, value) {
					var id = tag.replace(/ /g, '-');
					var $div = $('<div/>')
						.attr('id', id)
						.attr('tags', value)
						.data('tag-list', value)
						.html(tag + ' (' + device_counts[tag] + ')')
						.appendTo($device_tag_list);
				});				
				prev_checked_list.forEach((id) => $device_tag_list.find('#' + id).attr('checked', true));
				$device_tag_list.find('#All').prependTo($device_tag_list);
				
				if ($device_tag_list.find('#All[checked]').length) {
					$dashboard.find('.history-period').val('').pickmeup('clear');
					$dashboard.find('.history-period-block').attr('alert', true);
				} else {
					$dashboard.find('.history-period-block').removeAttr('alert');
				}

				prev_checked_list = $varbind_tag_list.find('input:checked').map((i, e) => e.id).get();
				$varbind_tag_list.empty();
				tags.All.forEach(function (tag) {
					var id = tag.replace(/ /g, '-');
		
					$('<div/>')
						.append($('<input type = "checkbox" autocomplete = "off"/>').attr('id', id))
						.append($('<label>').attr('for', id).html(tag))
						.appendTo($varbind_tag_list);
				});
				$varbind_tag_list.find('#latency').closest('div').prependTo($varbind_tag_list);

				var vt_visible_list = [];
				$device_tag_list.find('[checked]').each((i, e) => vt_visible_list =  vt_visible_list.concat($(e).data('tag-list')));
				$varbind_tag_list.find('input').each((i, e) => $(e).parent().toggle(vt_visible_list.indexOf(e.id) != -1));

				var caption = $device_tag_list.find('[checked]').map((i, e) => e.id).get().join(', ');
				$device_tag_list.siblings('.button').html(caption);
				if (!caption)
					return $device_tag_list.find('#All').trigger('click');

				if (prev_checked_list.length == 0 && vt_visible_list != 0)
					prev_checked_list.push($varbind_tag_list.find('input:first').attr('id'));				

				var event = jQuery.Event('click');
				event.ctrlKey = true;
				prev_checked_list.forEach((id) => $varbind_tag_list.find('#' + id).attr('checked', true).siblings('label').trigger(event));
			}	
		});

		$.ajax({
			method: 'GET',
			url: '/tag/lists',
			success: function(lists) {
				var $tag_list = $components.find('#page-device-edit #properties #tag-list').empty();
				lists.device.forEach((tag) => $('<span/>').addClass('a').html(tag).appendTo($tag_list));

				$tag_list = $components.find('#partial-varbind-list-edit #tag-list').empty();
				lists.varbind.forEach((tag) => $('<span/>').addClass('a').html(tag).appendTo($tag_list));
			}
		});
	}

	function updateAlertList(event) {
		var $alert_list = $page.find('#alert-list tbody');
		var $filter = $page.find('#alert-list-filter');

		if (!$alert_list.length || !$filter.length)
			return;

		var status_list = $filter.find('input:checkbox:checked').map((i, e) => e.value).get();
		var text = $filter.find('#filter-text').val().toLowerCase();

		$alert_list.find('tr').each(function (i, e) {
			var $e = $(e);
			$e.toggle((!status_list.length || status_list.indexOf($e.attr('status')) != -1) && (!text || e.innerHTML.toLowerCase().indexOf(text) != -1));
		});
	}

	function setHistoryPeriodSelector($where) { 
		return $where.find('.history-period').pickmeup({
			hide_on_select: true, 
			mode: 'range',
			show: function () {
				$(this).removeAttr('changed');
			},
			change: function () {
				$(this).attr('changed', true);
			}, 
			hide: function(e) {
				if (!this.hasAttribute('changed'))
					return;
	
				var $e = $(this);
				var period = $e.data('pickmeup-options').date;
				$e.closest('.history-period-block').find('.history-period-value').html($e.pickmeup('get_date', true).join(' - '));
	
				var data = {update: true, period: period};

				if (!$page.html())
					return $dashboard.trigger('update-dashboard', data);

				if ($page.find('#page-device-view').length)
					return $page.find('#page-device-view #varbind-list').attr('period', true).trigger('update-device', data);

				if ($page.find('#page-alert-list-view').length)
					return $page.find('#page-alert-list-view #alert-list').attr('period', true).trigger('update-alerts', data);

				console.error('Unknown period selector');
			}
		});
	}

	function createHistoryTableRow (e, value_type) {
		var period = (value_type != 'duration') ? cast('datetime', e.from) + ' - ' + cast('datetime', e.to) : cast('datetime', e.from);
		var value = (value_type != 'duration') ? cast(value_type, e.value) : cast(value_type, e.prev_value || 'N/A') + ' > ' + cast(value_type, e.value);

		return $('<tr/>')
			.attr('status', e.status)
			.data('event', e)
			.append($('<td>').html(period))
			.append($('<td>').html(value));
	}

	$app.on('click', '.history-period-value', function() {
		var $e = $(this);
		var position = $e.position();
		$e.closest('.history-period-block').find('.history-period')
			.css({top: position.top, left: position.left - 200 + $e.width(), display: 'block'})
			.pickmeup('show');
	});

	$page.on('click', '.ping-button', function() {
		var $e = $(this);
		var ip = $e.parent().find('#ip').val();
		$.ajax({
			type: 'GET',
			url: '/ping?ip=' + ip,
			success: (res) => $e.attr('status', res)
		});
	});

	$app.on('click', '.dropdown-click .content > *', function() {
		$(this).closest('.dropdown-click').trigger('blur');
	});

	function loadCheckList() {
		function onDone (check_list) {
			var $check_list = $page.find('#check-list');
			var $template_row = $check_list.find('#template-row');
			buildConditionList($template_row.find('#td-condition'));

			check_list.forEach(function(check) {
				var $row = $template_row.clone(true, true).attr('id', check.id);
				['name', 'include-tags', 'exclude-tags', 'protocol', 'divider', 'value-type', 'tags']
					.forEach((prop) => $row.find('#' + prop).val(check[prop] || check[prop.replace('-', '_')]));
				var cid = check.condition_id || check.condition && $row.find('#td-condition option[name="' + check.condition + '"]').attr('value') || 0;
				$row.find('#td-condition').attr('condition-id', cid).find('#condition-list').val(cid);
				$check_list.append($row);

				$row.find('#protocol').trigger('change');
				$row.find('#td-protocol-params')
					.find('input, select')
					.each(function(i, e) {
						if (check.protocol_params && check.protocol_params[e.id] !== undefined)
							$(e).val(check.protocol_params[e.id])
					});

				var $td_address = $row.find('#td-address');
				$.each(check.address || {}, (key, value) => $td_address.find('#' + key).val(value).attr('value', value));
			})
		}

		$.ajax({
			method: 'GET', 
			url: '/check', 
			success: onDone
		});
	}

	function updateNavigatorDevice(device) {
		var $e = $device_list.find('#' + device.id);
		if ($e.length == 0)	
			$e = $('<li/>')
				.attr('id', device.id)
				.append('<div id = "name"/>')
				.append('<div id = "ip"/>')
				.appendTo($device_list);
		var tag_list = device.tag_list || (device.tags || '').split(';').map((tag) => trim(tag));
		var tags = (device.tags || (device.tag_list || []).join(';')).replace(/;/g, ', ');
		var title = [device.description, tags ? 'Tags: ' + tags : null].filter((e) => !!e).join('\n');
		$e.data('tag-list', tag_list);
		$e.attr('title', title)
			.attr('status', device.status || 0)
			.attr('alive', device.alive);
		$e.find('#name').html(device.name);
		$e.find('#ip').html(device.ip).attr('title', device.mac);
		return $e;			
	}

	function updateProtocolTabsState () {
		$page.find('#protocols > label').removeClass('without-varbind');
		$page.find('.varbind-list tbody:not(:has(tr))').each(function() {
			var $e = $(this).closest('table');
			var protocol = $e.attr('protocol');
			$e.closest('#protocols').find('label[for="tab-' + protocol + '"]').addClass('without-varbind');
		})
	}

	function updateNavigatorStatus() {
		$app.find('#navigator').attr('status', Math.max.apply(null, $device_list.find('li').map((i, e) => e.getAttribute('status') || 0))); 
	}

	function addAlertListTableRow($table, alert) {
		$row = $table.find('#template-row').clone();
		$row.attr('id', alert.id).attr('status', alert.status).attr('time', alert.time).attr('device-id', alert.device_id).attr('is-hidden', alert.is_hidden);
		$row.find('#td-datetime').html(cast('datetime', alert.time));
		$row.find('#td-path').html(alert.path).attr('title', alert.path);
		$row.find('#td-description').html(alert.description);
		$row.find('#td-hint')
			.attr('device-id', alert.device_id)
			.attr('varbind-id', alert.varbind_id)
			.attr('time', alert.time)
			.css('visibility', alert.value_type == 'number' || alert.value_type == 'size' ? 'visible' : 'hidden') // is_history
			.css('pointer-events', !!alert.varbind_id ? '' :  'none');

		if (is_admin && !!alert.varbind_id && alert.status == 4) {
			var $reject = $('<div/>').addClass('reject icon icon-remove').attr('title', 'Reject. This is not an anomaly.');
			$row.find('#td-description').append($reject);
		}

		$row.prependTo($table);
	}

	function updateTemplates() {
		var error = (msg) => alert('Failed load templates: ' + msg);
		$.ajax({
			method: 'GET',
			url: '/template',
			dataType: 'json',
			error: (jqXHR, textStatus, errorThrown) => error(textStatus),
			success: function (template_list) {
				var $list = $app.find('#template-list');
				$list.children(':not([id])').remove();
				template_list.forEach(function (name) {
					$('<div/>')
						.addClass('device-add')
						.attr('name', name)
						.html(name)
						.append($('<span/>').attr('id', 'template-remove').attr('title', 'Remove template').addClass('icon icon-remove'))
						.appendTo($list);
					templates[name] = false;
				});
				$list.find('#import').appendTo($list);
			}
		});		
	}

	function updateTemplateInfo(name, callback) {
		$.ajax({
			method: 'GET',
			url: '/template/' + name,
			dataType: 'json',
			success: function (res) {
				if (!res)
					res = {};

				if (!res.varbind_list)
					res.varbind_list = [];

				var conditions = getConditions();
				res.varbind_list.forEach(function (varbind) {
					varbind.json_address = JSON.stringify(varbind.address || {})
					varbind.condition_id = conditions[varbind.condition] || 0;
				});					
				templates[name] = res;
				callback();
			}
		});			
	}

	function updateProtocolComponents() {
		$.ajax({
			method: 'GET',
			url: '/protocols',
			dataType: 'json',
			success: function (protocols) {
				var categories = ['native', 'external', 'collector', 'agent',  'expression'];
				var collator = new Intl.Collator();

				var protocol_list = $.map(protocols, function(data, id) {
					var $e = $('<div/>').html(data.html);
					var $info = $e.find('#info');
					return {
						id: id,
						name: $info.attr('name'),
						order: categories.indexOf($info.attr('category')) + 1,
						category: $info.attr('category'),
						$params: $e.find('#protocol-params').attr('protocol', id),
						$address: $e.find('#varbind-address'),
						$style: ($e.find('style')[0] || {}).innerHTML || '',
						$script: ($e.find('script')[0] || {}).innerHTML || '',
						$include: ($e.find('#include')[0] || {}).innerHTML || '',
						discovery: data.discovery
					}
				}).sort((a, b) => (a.order == b.order) ? collator.compare(a.name, b.name) : a.order - b.order);

				var styles = protocol_list.reduce((styles, protocol) => styles += protocol.$style, '');
				$('<style/>').text(styles).appendTo('body');

				var scripts = protocol_list.reduce((scripts, protocol) => scripts += protocol.$script, '');
				$('<script/>').text(scripts).appendTo('body');

				var includes = protocol_list.reduce((includes, protocol) => includes += protocol.$include, '');
				$('<div>').attr('id', 'include').html(includes).appendTo('body');

				// Device-edit page: update poller menu
				var $tabs = $components.find('#page-device-edit #page-content #protocols');
				var $varbind_list = $components.find('#partial-varbind-list-edit');
				protocol_list.forEach(function (protocol) {
					$('<input type = "radio" name = "tab" autocomplete = "off"/>').attr('id', 'tab-' + protocol.id).addClass('hidden').appendTo($tabs);
					$('<label/>').attr('for', 'tab-' + protocol.id).addClass('hidden icon icon-' + protocol.category).html(protocol.name)
						.append($('<span/>').addClass('remove icon icon-remove').attr('protocol', protocol.id))
						.appendTo($tabs);
					$tabs.append(' ');
				});	

				var $menu = $tabs.find('#protocol-menu');
				$menu.find('.content').append(protocol_list.map((p) => $('<div/>').attr('protocol', p.id).addClass('icon icon-' + p.category).html(p.name)));
				$menu.appendTo($tabs);
											
				protocol_list.forEach(function (protocol) {
					var $tab = $('<div/>').attr('id', 'page-' + protocol.id).addClass('hidden');

					protocol.$params.addClass('protocol-params').appendTo($tab);

					$varbind_list.clone(true, true).appendTo($tab)
						.find('#template-row #td-address').html(protocol.$address.html());

					if (protocol.discovery.length) { 
						var $discovery = $components.find('#partial-varbind-discovery').clone().attr('id', 'varbind-discovery');
						var $content = $discovery.find('.content');
						protocol.discovery.forEach((e) => $('<div/>').attr('id', e).html(e).appendTo($content));	
						$discovery.insertAfter($tab.find('#protocol-params'));
					}

					$('<details class = "help"/>')
						.attr('url', '/protocols/' + protocol.id + '/help.html')
						.append($('<summary/>').html(protocol.name + ' detail'))
						.append($('<div/>'))
						.appendTo($tab);
					$tab.appendTo($tabs);
				});	

				// Check-list page: update protocol selector for template row
				var $check_list = $components.find('#page-check-list-edit #check-list');
				var $template_row = $check_list.find('#template-row');
				var $protocols = $template_row.find('#td-protocol #protocol');
				protocol_list.forEach((protocol) => $('<option/>').attr('value', protocol.id).html(protocol.name).addClass(protocol.category).appendTo($protocols));
				$check_list.on('change', 'tbody #td-protocol #protocol', function() {
					var protocol = protocol_list[this.selectedIndex];

					var $tr = $(this).closest('tr');
					$tr.attr('protocol', protocol.id);
					$tr.find('#td-protocol-params').html(protocol.$params.clone());
					$tr.find('#td-address').html(protocol.$address.html());
				});

				var $template_row2 = $components.find('#partial-varbind-list-edit .varbind-list #template-row');	
				$template_row.find('#td-value-type').append($template_row2.find('#td-value-type').html());
				$template_row.find('#td-status-conditions').append($template_row2.find('#td-status-conditions').html());
			}
		})
	}

	function updateConditions() {
		$.ajax({
			method: 'GET',
			url: '/condition',
			dataType: 'json',
			success: function (list) {
				var $list = $components.find('#partial-varbind-condition-list #condition-list').remove('.condition');
				list.forEach(function(condition) {
					$('<option>')
						.attr('value', condition.id)
						.attr('name', condition.name)
						.html(condition.name)
						.addClass('condition')
						.appendTo($list);
				});
			}
		});
	}

	function getConditions() {
		var conditions = {};
		$components.find('#partial-varbind-condition-list #condition-list .condition').each((i, e) => conditions[e.getAttribute('value')] = e.innerHTML);
		return conditions;
	}

	$app.on('no-anomaly-detector', function (event, packet) {
		$app.find('#navigator #alert-block #anomaly').hide();
		$components.find('#page-alert-list-view #alert-list-filter label[for="filter-status-4"]').hide();
	});

	$app.on('status-updated', function (event, packet) {
		$device_list.find('li#' + packet.id).attr('status', packet.status || 0).attr('alive', packet.alive);
		updateNavigatorStatus();
	});

	$app.on('alert-summary', function (event, packet) {
		var $alert_block = $app.find('#navigator #alert-block');
		$alert_block.find('#anomaly').html(packet.anomaly);
		$alert_block.find('#warning').html(packet.warning);
		$alert_block.find('#critical').html(packet.critical);
	});

	$app.on('alert-info', function (event, packet) {
		var graph = graphs.device[packet.varbind_id];
		if (graph)
			graph.alerts[packet.time] = packet.status;

		var $table = $page.find('#alert-list');
		if (!$table.length)
			return;

		addAlertListTableRow($table, packet);	
		updateAlertList();
	});

	$app.on('values-updated', function (event, packet) {
		var $varbind_list = $page.find('#varbind-list');
		if (!$varbind_list.length || $varbind_list[0].hasAttribute('period'))
			return;

		$varbind_list.attr('updated', 'Updated: ' + cast('datetime', packet.time));

		var time = new Date(packet.time);
		var hour = 1000 * 60 * 60;
		$.each(packet.values, function(i, varbind) {
			var $row = $varbind_list.find('tr#' + varbind.id);
			if ($row.length == 0)
				return;

			var value = cast(varbind.value_type, varbind.value)
			$row.find('#td-value')
				.html(value)
				.attr('status', varbind.status)
				.attr('title', value + '\nUpdated: ' + cast('datetime', packet.time));

			if (varbind.is_history) {
				var val = parseFloat(varbind.value);
				var graph = graphs.device[varbind.id];
				if (!graph)
					return;

				var data = graph.file_;
				var range = graph.user_attrs_.valueRange;

				data = data.filter((e) => e[0].getTime() + hour > packet.time);
				data.push([time, !isNaN(val) ? val : data[data.length - 1][1]]);

				if (varbind.status == 2 || varbind.status == 3)
					graph.alerts[packet.time] = varbind.status;

				if (isNaN(val))
					graph.strings[packet.time] = varbind.value;

				graph.updateOptions({file: data, dateWindow: [data[0][0], (data.length > 1 && data[data.length - 1] || data[0] || [0])[0]]});
				return;
			}

			var $table = $row.find('#td-history table');
			if ($table.length == 0)
				return;

			var $last = $table.find('tr:last');
			var event = {from: packet.time, to: packet.time, prev_value: varbind.prev_value, value: varbind.value};
			var last_event = $last.data('event');

			if (varbind.value_type != 'duration' && varbind.value_type != 'number') {
				if ($last.length) {
					$last.remove();
					last_event.to = packet.time - 1;
					createHistoryTableRow(last_event, varbind.value_type).appendTo($table);
				} 

				if (!$last.length || varbind.value != last_event.value)	
					createHistoryTableRow(event, varbind.value_type).appendTo($table);
			}

			if (varbind.value_type == 'duration') {
				if ($last.length && (!isNaN(last_event.value) && !isNaN(event.value) && event.value - last_event.value > 0))
					return;	
				
				if ($last.length && last_event.value != event.value || !$last.length)
					createHistoryTableRow(last_event || event, varbind.value_type).appendTo($table);
			}
		});
	});

	$('body').on('keydown', function (event) {
		if (!is_admin || !$app.is(':visible'))
			return;
	
		// Ctrl + Shift + A: Hide all visible active alerts 
		if (event.ctrlKey && event.altKey && event.keyCode == 65) {
			var $alert_list = $app.find('#page #alert-list tbody');
			if ($alert_list.length == 0)
				return;
			
			var is_period = $alert_list.is('[period]');
			$.ajax({
				method: 'POST',
				url: '/alert/hide?ids=' + $alert_list.find('tr:visible:not([is-hidden="1"])').map((i, e) => parseInt(e.id)).get().join(';'),
				dataType: 'json',
				success: function (ids) {
					$alert_list.find('tr')
						.filter((i, e) => ids.indexOf(parseInt(e.id)) != -1)
						.each((i, e) => is_period ? e.setAttribute('is-hidden', 1) : e.remove());
				}
			});
		}

		// Ctrl + Shift + C: Show check list 
		if (event.ctrlKey && event.altKey && event.keyCode == 67) {
			$app.find('#check-list-edit').trigger('click'); // update back-button info
			loadCheckList();
		}
	});
});