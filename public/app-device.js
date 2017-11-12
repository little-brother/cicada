$(function(){
	var $app = $('#app-device').height(window.innerHeight);
	var $page = $app.find('#page');
	var $device_list = $app.find('#navigator #device-list');
	var $dashboard = $app.find('#dashboard');
	var $components = $('#components');

	var graphs = {device: {}, dashboard:{}};
	var templates = {};

	// INIT
	$app.splitter({limit: 200, onDragEnd});

	var is_admin = getCookie('access') == 'edit';
	if (is_admin) {
		updateTemplates();
		updateProtocolComponents();
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
			updateDashboardTags();

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
	$app.on('click', '#page-close', function() {
		$dashboard.removeAttr('hidden');
		$page.empty();
	});

	$app.on('click', '#device-list li', function(e, data) {
		$page.empty();
		$dashboard.attr('hidden', true);

		var $e = $(this);
		if ($e.hasClass('active') && !!e.originalEvent) {
			$dashboard.removeAttr('hidden');
			return $e.removeClass('active');
		}
	
		var device_id = $e.attr('id');
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
				$component.find('.history-period-block').show();

				var $varbind_list = $('<table/>').attr('id', 'varbind-list').attr('device-id', device_id).data('varbind-list', varbind_list);
				$.each(varbind_list, function (i, varbind) {
					$('<tr/>')
						.attr('id', varbind.id)
						.append($('<td id = "td-name"/>').html(varbind.name))
						.append($('<td id = "td-value"/>').text(cast(varbind.value_type, varbind.value)).attr('status', varbind.status))
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

	$app.on('update-device-list', function() {
		var tag_list = $dashboard.find('#device-tag-list input:checked').map((i, e) => e.id).get();
		$device_list.find('li').each(function (i, e) {
			var $e = $(e);
			var has_tag = !!($e.data('tag-list') || []).filter((e) => tag_list.indexOf(e) != -1).length;
			$e.toggle(has_tag);
		})
	});

	$page.on('update-device', '#page-device-view #varbind-list', function (event, data) {
		var $varbind_list = $(this);
		var varbind_list = $varbind_list.data('varbind-list');
		var from = data && data.period && data.period[0]; 
		var to = data && data.period && (data.period[1] + 24 * 3600 * 1000 - 1);

		var $cells = {};
		varbind_list.forEach(function (varbind) {
			$cells[varbind.id] = $varbind_list.find('tr#' + varbind.id + ' #td-history').empty().attr('is-number', varbind.value_type == 'number');
			if (varbind.value_type != 'number')
				$('<table/>').appendTo($cells[varbind.id]);
		});

		function makeRequestData(from, to) {
			return {from: parseInt(from), to: parseInt(to), downsample: from && to && (to - from > 2 * 60 * 60 * 1000)}
		}

		function onHistoryData(res) {
			if (!res.rows.length)
				return;

			deleteGraph('device');
		
			$.each(varbind_list.filter((varbind) => varbind.value_type == 'number'), function(i, varbind) {
				var idx = res.ids.indexOf(varbind.id);
				if (idx == -1)
					return;

				var data = res.rows.map((row) => [new Date(row[0]), row[idx + 1]]).filter((row) => !!row[1] || row[1] === 0);
				if (data.length == 0)
					return;

				var alerts = res.alerts[varbind.id];
				var strings = {};
				data.filter((row) => !$.isNumeric(row[1])).forEach((row) => strings[row[0].getTime()] = row[1] + '');
				normalizeHistory(data);

				var opts = {
					animatedZooms: true,
					valueRange: getRange(data),
					labels: ['time', 'value'],
					highlightCircleSize: 2,					
					height: 116,
					axes: {
						x: {valueFormatter: (ms) => cast('datetime', ms)},
						y: {valueFormatter: (val, opts, seriesName, g, row) => strings[g.getValue(row, 0)] || val}
					},
					verticalCrosshair: true,
					drawPoints: true,
					drawPointCallback: function (g, seriesName, canvasContext, cx, cy, seriesColor, pointSize, row) {
						var time = g.getValue(row, 0);
						var status = alerts[time];
						if (status)	
							return drawCircle(canvasContext, cx, cy, status == 2 ? 'gold' : '#f00', 3);

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
			$.each(varbind_list.filter((varbind) => varbind.value_type == 'number'), function(i, varbind) {
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
				data: makeRequestData(from, to),	
				success: callback
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
	$app.on('click', '.top-menu .device-add', function() {
		var $e = $(this); name
		var template_name = $e.attr('name');

		if (!!template_name && !templates[template_name])
			return updateTemplateInfo(template_name, () => $e.trigger('click'));

		$page.empty();
		var $component = $components.find('#page-device-edit').clone(true, true);
		$component.find('#properties #template').val(template_name);
		
		setVarbindList($page, $component,  templates[template_name] || []);				
	});

	$app.on('click', '#page-close, .device-add, #device-scan, #navigator #alert-block, #check-list-edit', function() {
		$device_list.find('li.active').removeClass('active');
	});

	$page.on('click', '.top-menu #device-edit, .top-menu #device-clone', function() {
		var $e = $(this);
		$.ajax({
			method: 'GET',
			url: '/device/' + $e.attr('device-id'),
			success: function (device) {
				$page.empty();
				var $component = $components.find('#page-device-edit').clone(true, true);
				if ($e.attr('id') == 'device-edit') {
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
					$component.find('#template').val(device.template);
				} else {
					$component.find('#id').attr('cloned', device.id);
					$component.find('#name').val(device.name + ' clone');
					$component.find('#template').val(device.template);
				}
				$component.find('#tags').val(device.tags);
		
				for (var protocol in device.protocols) {
					$component
						.find('#protocols #page-' + protocol)
						.find('input, select')
						.each((i, e) => $(e).val(device.protocols[protocol] && device.protocols[protocol][e.id]));
				}
				
				setVarbindList($page, $component, device.varbind_list);
			}
		})	
	});

	$page.on('change', '.varbind-list #if', function() {
		$(this).attr('if', this.value);
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

	$page.on('change', '#page-device-edit .varbind-list input', function() {
		$(this).closest('table.varbind-list').attr('changed', true);
	});

	// set non-numeric element to one of nearest
	function normalizeHistory(data, col) {
		col = parseInt(col) || 1;
		data.forEach(function (row, no) {
			if ($.isNumeric(row[col])) // ? row[col] == null
				return;	

			row[col] = data[no - 1] != undefined && $.isNumeric(data[no - 1][col]) && data[no - 1][col] || data[no + 1] != undefined && $.isNumeric(data[no + 1][col]) && data[no + 1][col] || 0;
		});
	}

	function buildConditionList(condition_list) {
		var $template_row = $components.find('#partial-varbind-condition');
		return (condition_list || []).map(function (condition) {
			var $row = $template_row.clone().removeAttr('id');
			$row.find('#if').val(condition.if).attr('if', condition.if);
			$row.find('#value').val(condition.value);
			$row.find('#status').val(condition.status);
			return $row;
		});
	}

	function setVarbindList($page, $component, varbind_list) {
		var $vb_table = $components.find('#partial-varbind-list-edit .varbind-list');

		$component.find('#protocols div[id^="page-"]').each(function(i, e) {
			var $e = $(e);
			var protocol = e.id.substring(5);
			var $varbind_list = $e.find('.varbind-list').attr('protocol', protocol);
			var $template_row = $varbind_list.find('#template-row');			
			$.each(varbind_list, function(i, varbind) {
				if (varbind.protocol != protocol)
					return;

				var $row = $template_row.clone(true, true).removeAttr('id');
				$row.attr('id', varbind.id);
				$row.find('#name').val(varbind.name);

				var $td_address = $row.find('#td-address');
				$.each(varbind.address || {}, (key, value) => $td_address.find('#' + key).val(value).attr('value', value).closest('tr').attr('value', value));
				
				$row.find('#divider').val(varbind.divider || 1);
				$row.find('#value-type').val(varbind.value_type || 'string');
				
				var $condition_list = buildConditionList(varbind.status_conditions);
				$row.find('#td-status-conditions #condition-list').append($condition_list);

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
		$component.find('#protocols label:Visible:first').trigger('click');
		updateProtocolTabsState();
	}

	function getVarbindList(templated) {
		var varbind_list = [];
		$page.find('.varbind-list').each(function(i, e) {
			$varbind_list = $(e);
			var protocol = $varbind_list.attr('protocol');
			$varbind_list.find('tbody tr').each(function(j, row) {
				var $row = $(row);
				var varbind = {
					protocol: trim(protocol),
					id: parseInt($row.attr('id')),
					name: trim($row.find('#name').val()),
					divider: trim($row.find('#divider').val()),
					value_type: $row.find('#value-type').val(),
					tags: trim($row.find('#tags').val()),
					check_id: $row.attr('check-id')
				}
				
				var address = {};
				var $td_address = $row.find('#td-address');
				$.each($td_address.find('input, select, textarea'), (i, e) => address[e.id] = trim(e.value));
				
				var status_conditions = [];
				$row.find('#td-status-conditions .status-condition').each(function() {
					var $cond = $(this);	
					status_conditions.push({
						if: $cond.find('#if').val(),
						value: trim($cond.find('#value').val()),
						status: $cond.find('#status').val()
					});
				});

				if (templated) {
					delete varbind.id;
					varbind.address = address;
					varbind.status_conditions = status_conditions;
				} else {
					varbind.json_address = JSON.stringify(address);
					varbind.json_status_conditions = JSON.stringify(status_conditions);
				}
			
				varbind_list.push(varbind);
			})
		})

		return varbind_list.filter((varbind) => !varbind.check_id);	// ignore group check
	}

	$page.on('click', '.top-menu #device-save', function() {
		var $props = $page.find('#page-content #properties');
		var $protocols = $page.find('#page-content #protocols'); 

		var data = {
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
			template: trim($props.find('#template').val())
		};

		var protocol_params = {};
		$protocols.find('input:radio[name="tab"]')
			.map((i, e) => e.id.substring(4)) // tab-#protocol)
			.filter((i, protocol) => $protocols.find('#page-' + protocol + ' .varbind-list tbody').has('tr').length)
			.each(function(i, protocol) {
				var params = {};
				$protocols.find('#page-' + protocol + ' #protocol-params')
					.find('input, select, textarea')
					.each((i, param) => params[param.id] = trim(param.value));
				protocol_params[protocol] = params;
			});

		data.json_protocols = JSON.stringify(protocol_params);
		data.json_varbind_list = JSON.stringify(getVarbindList());
		
		$.ajax({
			method: 'POST',
			url: '/device',
			data: data,
			dataType: 'text',
			success: function (id) {
				data.id = id;
				updateNavigatorDevice(data).click();
				$app.trigger('update-device-list');
			}
		})
	});

	$page.on('click', '.top-menu #device-save-cancel', function() {
		var id = $page.find('#page-content #properties #id');
		var $e = $device_list.find('li#' + (id.val() || id.attr('cloned') || 0));

		return ($e.length > 0) ? $e.click() : $page.empty() && $dashboard.removeAttr('hidden');
	});

	$page.on('click', '#page-device-edit #template-save', function() {
		var name = trim($page.find('#page-device-edit #properties #name').val());
		if (!name)
			return alert('The name is empty');

		if (templates[name] != undefined && !confirm('Overwrite?'))
			return;

		var varbind_list = getVarbindList(true);
		$.ajax({
			method: 'POST',
			url: '/template/' + name,
			data: {
				varbind_list: JSON.stringify(varbind_list, 1, '\t')
			},
			success: (res) => templates[name] = varbind_list
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
			}
		});
	});

	$page.on('click', '#page-device-edit .varbind-list #varbind-add', function() {
		var $table = $(this).closest('.varbind-list');
		$table.find('#template-row').clone()
			.removeAttr('id')
			.appendTo($table.find('tbody'))
			.find('input:text').each((i, e) => e.value = e.getAttribute('value'));
		updateProtocolTabsState();
	});

	$page.on('click', '#page-device-edit .varbind-list #varbind-remove', function() {
		$(this).closest('tr').remove();
		updateProtocolTabsState();	
	});

	$page.on('click', '#page-check-list-edit .varbind-list #check-remove', function() {
		$(this).closest('tr').remove();
	});

	$page.on('click', '#page-device-edit #condition-add, #page-check-list-edit #condition-add', function() {
		$components.find('#partial-varbind-condition').clone().removeAttr('id').appendTo($(this).parent().find('#condition-list'));
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
			}
		})
	});

	$app.on('click', '#check-list-edit', function () {
		$page.empty();
		$dashboard.attr('hidden', true);
			
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
				tags: $row.find('#td-tags #tags').val()
			}  
			check.json_protocol_params = getValues($row.find('#td-protocol-params'), true);
			check.json_address = getValues($row.find('#td-address'), true);

			var condition_list = $row.find('#td-status-conditions .status-condition').map(function() {
				var $e = $(this);	
				return {
					if: $e.find('#if').val(),
					value: trim($e.find('#value').val()),
					status: $e.find('#status').val()
				};
			}).get() || [];
			check.json_status_conditions = JSON.stringify(condition_list);

			return check;
		}).get() || [];

		$.ajax({
			method: 'POST',
			url: '/check',
			data: {
				check_list: JSON.stringify(check_list)
			},	
			onsuccess: () => $app.find('#page-close').trigger('click')
		});
	});

	$page.on('click', '.top-menu #check-cancel', function() {
		$app.find('#page-close').trigger('click');
	});

	$app.on('click', '#navigator #alert-block', function() {
		if ($page.find('#alert-list').length) 
			return $page.empty();

		$page.empty();
		var $component = $components.find('#page-alert-list-view').clone(true, true);	

		$selector = setHistoryPeriodSelector($component);
		$component.find('.history-period-block').show();
		$component.appendTo($page);
		$component.find('#alert-list').trigger('update-alerts');		
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
			}
		})
	});

	$page.on('click', '#alert-list #td-datetime, #alert-list #td-device', function () {
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
				console.log(jqXHR, textStatus, errorThrown);
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
					$row.find('#description').val(device.description);
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
	
		var data = {
			name: trim($row.find('#name').val()),
			ip: trim($row.find('#ip').val()),
			mac: trim($row.find('#mac').val()),
			is_pinged: $row.find('#is-pinged:checked').length,
			period: parseInt($row.find('#period').val()) || 60,
			tags: trim($row.find('#tags').val()),
			description: trim($row.find('#description').val()),
			json_varbind_list: JSON.stringify(template),
			template: trim(template_name)
		}

		$.ajax({
			method: 'POST',
			url: '/device',
			data: data,
			success: function(id) {
				data.id = id;
				updateNavigatorDevice(data);
				$row.find('#td-add').html('&#10004;');
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

	$dashboard.on('click', '#device-tag-list input', function() {
		var $device_tag_list = $dashboard.find('#device-tag-list');
		var $varbind_tag_list = $dashboard.find('#varbind-tag-list');
		var $checked_list = $device_tag_list.find('input:checked:not(#All)');

		var $period = $dashboard.find('.history-period-block');
		$period.hide();
		$period.find('.history-period').val('').pickmeup('clear');
		$period.find('.history-period-value').html('Last hour');

		var time = new Date();
		$varbind_tag_list.find('input:checked').removeAttr('checked');
		deleteGraph('dashboard');
			
		if (this.id == 'All' || $checked_list.length == 0) {
			$device_tag_list.find('input:not(#All)').attr('checked', false).prop('checked', false);
			$device_tag_list.find('#All').attr('checked', true).prop('checked', true);
			$varbind_tag_list.find('div').show();
			$device_list.find('li').show();
			return;
		}

		$device_tag_list.find('#All').attr('checked', false).prop('checked', false);		
		$varbind_tag_list.find('div').hide();
		$checked_list.each(function(i, e) {
			var tag_list = $(e).closest('div').data('tag-list') || [];
			$.each(tag_list, function (i, tag) {
				var id = tag.replace('/ /g', '-');
				$varbind_tag_list.find('#' + id).closest('div').show();
			})
		});

		$app.trigger('update-device-list');
	});

	$dashboard.on('click', '#varbind-tag-list label', function(event) {
		var $e = $(this).prev();
		var tag = $e.attr('id');
		if (!event.ctrlKey) {
			$dashboard.find('#varbind-tag-list input:checked:not(#' + tag + ')').removeAttr('checked');
			$e.prop('checked', false);
		} else {
			$e.prop('checked', !$e.prop('checked'));
			event.preventDefault();
		}

		$dashboard.find('.history-period-block').show();
		var period = $dashboard.find('.history-period').pickmeup('get_date') || null;
		if (period && period.length > 0) 
			period = [period[0].getTime(), period[1].getTime()];
		setTimeout(() => $dashboard.trigger('update-dashboard', {period: period}), 10);
	});

	$dashboard.on('update-dashboard', function(event, event_data) {
		if (event_data.update)
			deleteGraph('dashboard');

		var device_tags = $dashboard.find('#device-tag-list input:checked').map((i ,e) => e.id).get().join(';');
		var varbind_tags = $dashboard.find('#varbind-tag-list input:checked').map((i, e) => e.id).get();

		var etag = varbind_tags.filter((tag) => !graphs.dashboard[tag])[0];

		if (!etag) {
			for (var tag in graphs.dashboard) {
				if (varbind_tags.indexOf(tag) == -1)
					deleteGraph('dashboard', tag);
			}

			var h = ($app.height() - $dashboard.find('#tag-list').height() - 60) / varbind_tags.length;
			varbind_tags.forEach((tag) => $(graphs.dashboard[tag].graphDiv.parentNode).height(h));
			
			var $graphs = $dashboard.find('.graph').sort((a, b) => varbind_tags.indexOf(a.getAttribute('tag')) - varbind_tags.indexOf(b.getAttribute('tag')));
			$graphs.detach().appendTo($dashboard.find('#graph-block'));

			Dygraph.synchronize(varbind_tags.map((tag) => graphs.dashboard[tag]));

			return window.dispatchEvent(new Event('resize'));
		}

		delete event_data.update;

		function makeRequestData(from, to) {
			return {from, to, downsample: from && to && (to - from > 2 * 60 * 60 * 1000), tags: device_tags}; 
		}

		function onData(res) {
			var data = res.rows;
			data.forEach((row) => row[0] = new Date(row[0]));

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
				labels: res.columns,
				valueRange: getRange(data),
				highlightCircleSize: 2,					
				height: $app.height() - $dashboard.find('#tag-list').height() - 60,
				//height: 100,
				ylabel: etag,
				axes: {
					x: {valueFormatter: (ms) => cast('datetime', ms)},
					y: {valueFormatter: function (val, opts, seriesName, g, row) {
							var varbind_id = names[seriesName];	
							return strings[varbind_id] && strings[varbind_id][g.getValue(row, 0)] || val;
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
						return drawCircle(canvasContext, cx, cy, status == 2 ? 'gold' : '#f00', 3);

					if (strings[varbind_id] && strings[varbind_id][time])
						return drawCircle(canvasContext, cx, cy, '#000', 2);
				}
			};

			if (res.downsampled) {				
				opts.zoomCallback = function (minDate, maxDate, yRange)	{
					var g = this;
					if (minDate == g.rawData_[0][0] && maxDate == g.rawData_[g.rawData_.length - 1][0]) // Unzoom
						return; 

					$.ajax({
						method: 'GET',
						url: '/tag/' + etag,
						data: makeRequestData(minDate, maxDate),
						success: function (sub) {
							if (sub.rows.length == 0)
								return;

							var length = sub.rows[0].length;
							for (var i = 1; i < length; i++)
								normalizeHistory(sub.rows, i);
							
							var data = [].concat(g.rawData_.filter((r) => r[0] < minDate), sub.rows, g.rawData_.filter((r) => r[0] > maxDate));
							data.forEach((row) => row[0] = new Date(row[0]));
							g.updateOptions({file: data});
						}
					});					
				}	
			}

			graphs.dashboard[etag] = new Dygraph($('<div/>').attr('tag', etag).addClass('graph').appendTo($dashboard.find('#graph-block')).get(0), data, opts);
			graphs.dashboard[etag].alerts = alerts;
			graphs.dashboard[etag].strings = strings;
			$dashboard.trigger('update-dashboard', event_data);
		}

		$.ajax({
			method: 'GET',
			url: '/tag/' + etag,
			data: makeRequestData(event_data.period && event_data.period[0], event_data.period && (event_data.period[1] + 24 * 3600 * 1000 - 1)),
			success: onData
		})
	});

	function deleteGraph(where, id) {
		if (!graphs[where])
			return console.error('deleteGraph: Bad "where" request - ' + where);

		function deleteById(id) {
			if (graphs[where][id]) {
				try {	
					graphs[where][id].graphDiv.parentNode.remove();
					graphs[where][id].destroy();
				} catch (err) {}
				delete graphs[where][id];
			}
		}
			
		if (id != undefined)
			return deleteById(id);	

		for (var id in graphs[where]) 
			deleteById(id);
	}

	function updateDashboardTags () {
		deleteGraph('dashboard');

		$dashboard.find('.history-period').val('').pickmeup('clear');
		
		function addTag($target, tag, data) {
			var id = tag.replace('/ /g', '-');

			$('<div/>')
				.attr('tags', data)
				.data('tag-list', data)
				.append($('<input type = "checkbox" autocomplete = "off"/>').attr('id', id))
				.append($('<label>').attr('for', id).html(tag))
				.appendTo($target);
		}

		$.ajax({
			method: 'GET',
			url: '/tag',
			success: function(tags) {
				var $device_tag_list = $dashboard.find('#device-tag-list').empty();
				$.each(tags, (tag, value) => addTag($device_tag_list, tag, value));				
				$device_tag_list.find('#All').attr('checked', true).closest('div').prependTo($device_tag_list);
	
				var $varbind_tag_list = $dashboard.find('#varbind-tag-list').empty();
				$.each(tags.All, (i, tag) => addTag($varbind_tag_list, tag));
				$varbind_tag_list.find('#latency').closest('div').prependTo($varbind_tag_list);

				var $tag_list = $components.find('#page-device-edit #properties #tag-list').empty();
				Object.keys(tags).filter((e) => e != 'All').forEach((tag) => $('<span/>').addClass('a').html(tag).appendTo($tag_list))
				$tag_list = $components.find('#partial-varbind-list-edit #tag-list').empty();
				(tags.All || []).filter((e) => e != 'latency').forEach((tag) => $('<span/>').addClass('a').html(tag).appendTo($tag_list));
			}
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
		$.ajax({
			type: 'GET',
			url: '/ping?ip=' + $e.parent().find('#ip').val(),
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
			check_list.forEach(function(check) {
				var $row = $template_row.clone(true, true).attr('id', check.id);
				['name', 'include-tags', 'exclude-tags', 'protocol', 'divider', 'value-type', 'tags']
					.forEach((prop) => $row.find('#' + prop).val(check[prop] || check[prop.replace('-', '_')]));

				var $condition_list = buildConditionList(check.status_conditions);
				$row.find('#td-status-conditions #condition-list').append($condition_list);

				$check_list.append($row);
				
				$row.find('#protocol').trigger('change');

				$row.find('#td-protocol-params').find('input, select')
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
		
		$e.data('tag-list', device.tag_list || (device.tags || '').split(';').map((tag) => trim(tag)));
		$e.attr('title', device.description).attr('status', device.status || 0);
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
		$row.find('#td-device').html(alert.device_name);
		$row.find('#td-reason').html(alert.reason);		
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
				var $list = $app.find('#template-list').empty().append($('<div class = "device-add"/>').html('New...'));
				template_list.forEach(function (name) {
					$('<div/>')
						.addClass('device-add')
						.attr('name', name)
						.html(name)
						.append($('<span/>').attr('id', 'template-remove').attr('title', 'Remove template').html('&#10006;'))
						.appendTo($list);
					templates[name] = false;
				});	
			}
		});		
	}

	function updateTemplateInfo(name, callback) {
		$.ajax({
			method: 'GET',
			url: '/template/' + name,
			dataType: 'json',
			success: function (res) {
				templates[name] = res || [];
				templates[name].forEach(function(varbind) {
					varbind.json_address = JSON.stringify(varbind.address || {});
					varbind.json_status_conditions = JSON.stringify(varbind.status_conditions || []);					
				})
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

				var protocol_list = $.map(protocols, function(html, id) {
					var $e = $('<div/>').html(html);
					var $info = $e.find('#info');
					return {
						id: id,
						name: $info.attr('name'),
						order: categories.indexOf($info.attr('category')) + 1,
						category: $info.attr('category'),
						$params: $e.find('#protocol-params').attr('protocol', id),
						$address: $e.find('#varbind-address'),
						$style: ($e.find('style')[0] || {}).innerHTML || '',
						$script: ($e.find('script')[0] || {}).innerHTML || ''
					}
				}).sort((a, b) => (a.order == b.order) ? collator.compare(a.name, b.name) : a.order - b.order);

				var styles = protocol_list.reduce((styles, protocol) => styles += protocol.$style, '');
				$('<style/>').text(styles).appendTo('body');

				var scripts = protocol_list.reduce((scripts, protocol) => scripts += protocol.$script, '');
				$('<script/>').text(scripts).appendTo('body');

				// Device-edit page: update poller menu
				var $tabs = $components.find('#page-device-edit #page-content #protocols');
				var $varbind_list = $components.find('#partial-varbind-list-edit');
				protocol_list.forEach(function (protocol) {
					$('<input type = "radio" name = "tab" autocomplete = "off"/>').attr('id', 'tab-' + protocol.id).addClass('hidden').appendTo($tabs);
					$('<label/>').attr('for', 'tab-' + protocol.id).addClass(protocol.category).addClass('hidden').html(protocol.name)
						.append($('<span/>').addClass('remove').attr('protocol', protocol.id).html('&#10006;'))
						.appendTo($tabs);
					$tabs.append(' ');
				});	

				var $menu = $tabs.find('#protocol-menu');
				$menu.find('.content').append(protocol_list.map((p) => $('<div/>').attr('protocol', p.id).addClass(p.category).html(p.name)));
				$menu.appendTo($tabs);
											
				protocol_list.forEach(function (protocol) {
					var $tab = $('<div/>').attr('id', 'page-' + protocol.id).addClass('hidden');
					protocol.$params.appendTo($tab);
					var $vl = $varbind_list.clone(true, true).appendTo($tab).find('#template-row #td-address').html(protocol.$address.html());

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

	$app.on('status-updated', function (event, packet) {
		$device_list.find('li#' + packet.id).attr('status', packet.status || 0);
		updateNavigatorStatus();
	});

	$app.on('alert-summary', function (event, packet) {
		var $alert_block = $app.find('#navigator #alert-block');
		$alert_block.find('#warning').html(packet.warning);
		$alert_block.find('#critical').html(packet.critical);
	});

	$app.on('alert-info', function (event, packet) {
		var $table = $page.find('#alert-list');
		if (!$table.length)
			return;
	
		addAlertListTableRow($table, packet);
	});

	$app.on('values-updated', function (event, packet) {
		var $varbind_list = $page.find('#varbind-list');
		if (!$varbind_list.length || $varbind_list[0].hasAttribute('period'))
			return;

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

			if (varbind.value_type == 'number') {
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

				if (!isNaN(val) && (val < range[0] || val > range[1])) 
					range = getRange(data);
			
				graph.updateOptions({file: data, valueRange: range, dateWindow: [data[0][0], data[data.length - 1][0]]});
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

	$app.on('ajax-complete', function (event, settings) {
		if (settings.url == '/device' && settings.method == 'POST') 
			return updateNavigatorStatus() || updateDashboardTags();

		if (settings.url.indexOf('/device/') == 0 && settings.method == 'DELETE')
			return updateDashboardTags();

		if (/^\/device\/([\d]*)\/varbind-history$/.test(settings.url)) 
			return $app.find('#device-history-period').pickmeup('set_date', new Date());

		if (settings.url.indexOf('/template/') == 0 && (settings.method == 'POST' || settings.method == 'DELETE'))	
			return updateTemplates();		
	});

	$('body').on('keydown', function (event) {
		if (!is_admin || !$app.is(':visible'))
			return;

		
		// Ctrl + Shift + A: Hide all active alerts 
		if (event.ctrlKey && event.altKey && event.keyCode == 65) {
			var $alert_list = $app.find('#page #alert-list tbody');
			if ($alert_list.length == 0)
				return;
			
			$.ajax({
				method: 'POST',
				url: '/alert/hide',
				success: () => $alert_list.empty()
			});
		}

		// Ctrl + Shift + C: Show check list 
		if (event.ctrlKey && event.altKey && event.keyCode == 67) {
			$app.find('#check-list-edit').trigger('click');
			loadCheckList();
		}
	});
});