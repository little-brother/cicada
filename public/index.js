$(function(){
	var $app = $('#app').height(window.innerHeight);
	var $page = $app.find('#page');
	var $device_list = $app.find('#navigator #device-list');
	var $dashboard = $app.find('#dashboard');
	var $components = $('#components');

	var graphs = {};
	var templates = {};

	$app.splitter({orientation: 'horizontal', limit: 200});

	$.ajax({
		method: 'GET',
		url: '/device',
		dataType: 'json',
		success: function (devices) {
			devices.forEach(setDevice);
			setHistoryPeriodSelector($dashboard);
			updateNavigatorStatus();
			updateDashboard();
		}
	});

	$app.on('click', '#page-close', function() {
		$page.empty();
	});

	$app.on('click', '#device-list li', function(e, data) {
		$page.empty();

		var $e = $(this);
		if ($e.hasClass('active') && !!e.originalEvent)
			return $e.removeClass('active');
	
		var device_id = $e.attr('id');
		$.ajax({
			method: 'GET',
			url: '/device/' + device_id + '/varbind-list',
			dataType: 'json',
			success: function(varbind_list) {
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
						.append($('<td id = "td-value"/>').html(cast(varbind.value_type, varbind.value)).attr('status', varbind.status))
						.append($('<td id = "td-history"/>').attr('value-type', varbind.value_type))
						.appendTo($varbind_list);
				});
				$varbind_list.appendTo($component.find('#page-content'));

				if (data && data.period) {
					return $selector.pickmeup('set_date', [new Date(data.period[0]), new Date(data.period[1])]).attr('changed', true).pickmeup('hide');
				}

				$varbind_list.trigger('update-data');
			}
		});
	});

	$page.on('update-data', '#page-device-view #varbind-list', function (event, data) {
		var $varbind_list = $(this);
		var varbind_list = $varbind_list.data('varbind-list');
		var from = data && data.period && data.period[0]; 
		var to = data && data.period && data.period[1];

		var $cells = {};
		varbind_list.forEach(function (varbind) {
			$cells[varbind.id] = $varbind_list.find('tr#' + varbind.id + ' #td-history').empty().attr('is-number', varbind.value_type == 'number');
			if (varbind.value_type != 'number')
				$('<table/>').appendTo($cells[varbind.id]);
		});
			
		$.ajax({
			method: 'GET',
			url: '/device/' + $varbind_list.attr('device-id') + '/varbind-history',
			data: {from, to},	
			success: function (res) {
				if (!res.rows.length)
					return;

				$.each(varbind_list.filter((varbind) => varbind.value_type == 'number'), function(i, varbind) {
					var idx = res.columns.indexOf('varbind' + varbind.id);
					if (idx == -1)
						return;

					deleteGraph(varbind.id);
					var data = res.rows.map((row) => [new Date(row[0]), row[idx]]);
					if (data.length == 0)
						return;

					var alerts = res.alerts[varbind.id];
					var opts = {
						animatedZooms: true,
						valueRange: getRange(data),
						labels: ['time', 'value'],
						highlightCircleSize: 2,					
						height: 120,
						axes: {
							x: {valueFormatter: (ms) => cast('datetime', ms)}
						},
						drawPoints: true,
						drawPointCallback: function (g, seriesName, canvasContext, cx, cy, seriesColor, pointSize, row) {
							var status = alerts[g.getValue(row, 0)];
							if (!status)	
								return;
							drawCircle(canvasContext, cx, cy, status == 2 ? 'gold' : '#f00', 3);
						}
					};
				
					graphs[varbind.id] = new Dygraph($cells[varbind.id].get(0), data, opts);
					graphs[varbind.id].alerts = alerts;
				})
			}
		});

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

	$app.on('click', '.top-menu .device-add', function() {
		var $e = $(this); name
		var template_name = $e.attr('name');

		if (!!template_name && !templates[template_name])
			return updateTemplateInfo(template_name, () => $e.trigger('click'));

		$page.empty();
		var $component = $components.find('#page-device-edit').clone(true, true);
		
		setVarbindList($component,  templates[template_name] || []);

		$component.find('#protocols input:radio:first').prop('checked', true);
		$component.find('#properties #template').val(template_name);
		$component.appendTo($page);
		highlightProtocolTabs();				
	});

	$app.on('click', '#page-close, .device-add, #device-scan, #navigator #alert-block', function() {
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
				
				setVarbindList($component, device.varbind_list);

				$component.find('#protocols input:radio:first').prop('checked', true);
				$component.appendTo($page);	
				highlightProtocolTabs();
			}
		})	
	});

	$page.on('change', '#page-device-edit .varbind-list #if', function() {
		$(this).attr('if', this.value);
	});

	$page.on('change', '#page-device-edit .varbind-list input', function() {
		$(this).closest('table.varbind-list').attr('changed', true);
	});

	function setVarbindList($component, varbind_list) {
		var $vb_table = $components.find('#block-varbind-list-edit .varbind-list');

		$component.find('#protocols div[id^="page-"]').each(function(i, e) {
			var $e = $(e);
			var protocol = e.id.substring(5);
			var $varbind_list = $vb_table.clone().attr('protocol', protocol);
			var $template_row = $varbind_list.find('#template-row');
			$template_row.find('#td-address #address').html($components.find('#partial-varbind-address-' + protocol).html());
			
			$.each(varbind_list, function(i, varbind) {
				if (varbind.protocol != protocol)
					return;

				var $row = $template_row.clone(true, true).removeAttr('id');
				$row.attr('id', varbind.id);
				$row.find('#name').val(varbind.name);

				var $td_address = $row.find('#td-address');
				var isExpression = !!varbind.address && !!varbind.address.expression
				var $address = $td_address.find('#address').toggle(!isExpression);
				var $expression = $td_address.find('#expression').toggle(isExpression);
				if (isExpression) {
					$expression.val(varbind.address.expression).show();
				} else {
					$.each(varbind.address || {}, (key, value) => $address.find('#' + key).val(value).attr('value', value));
				}	
				
				$row.find('#divider').val(varbind.divider);
				$row.find('#value-type').val(varbind.value_type || 'string');
				$cond_template_row = $components.find('#partial-varbind-condition');
			
				var $condition_list = $row.find('#td-status-conditions #condition-list');
				$.each(varbind.status_conditions || [], function(i, status_condition) {
					var $condition = $cond_template_row.clone().removeAttr('id');
					$condition.find('#if').val(status_condition.if).attr('if', status_condition.if);
					$condition.find('#value').val(status_condition.value);
					$condition.find('#status').val(status_condition.status);
					$condition.appendTo($condition_list);
				});

				$row.find('#tags').val(varbind.tags);
				$row.appendTo($varbind_list);
			});

			$varbind_list.insertAfter($e.find('#protocol-params'));
		});
	}

	function getVarbindList(templated) {
		var varbind_list = [];
		$page.find('.varbind-list').each(function(i, e) {
			$varbind_list = $(e);
			var protocol = $varbind_list.attr('protocol');
			$varbind_list.find('tbody tr').each(function(j, row) {
				var $row = $(row);
				var varbind = {
					protocol: protocol,
					id: $row.attr('id'),
					name: $row.find('#name').val(),
					divider: $row.find('#divider').val(),
					value_type: $row.find('#value-type').val(),
					tags: $row.find('#tags').val()	
				}
				
				var address = {};
				var $td_address = $row.find('#td-address');
				var $expression = $td_address.find('#expression:visible');
				if ($expression.length > 0) {
					address.expression = $expression.val();
				} else {
					$.each($td_address.find('#address').find('input, select'), (i, e) => address[e.id] = e.value);
				};
				
				var status_conditions = [];
				$row.find('#td-status-conditions .status-condition').each(function() {
					var $cond = $(this);	
					status_conditions.push({
						if: $cond.find('#if').val(),
						value: $cond.find('#value').val(),
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
		
		return varbind_list;	
	}

	$page.on('click', '.top-menu #device-save', function() {
		var $props = $page.find('#page-content #properties');
		var $protocols = $page.find('#page-content #protocols'); 

		var data = {
			id: $props.find('#id').val(),
			name: $props.find('#name').val(),
			description: $props.find('#description').val(),
			ip: $props.find('#ip').val(),
			period: $props.find('#period').val(),
			timeout: $props.find('#timeout').val(),
			mac: $props.find('#mac').val(),
			tags: $props.find('#tags').val(),
			is_pinged: $props.find('#is-pinged:checked').length,
			parent_id: $props.find('#check-parent-at-failure:checked').length,
			force_status_to:  $props.find('#force-status-to').val(),
			template: $props.find('#template').val()
		};

		var protocol_params = {};
		$protocols.find('input:radio[name="tab"]').each(function(i, e) {
			var protocol = e.id.substring(4); // tab-#protocol
			var params = {};
			$protocols.find('#page-' + protocol + ' #protocol-params').find('input, select').each(function(i, param) {
				params[param.id] = param.value;
			})
			protocol_params[protocol] = params;
		})
		data.json_protocols = JSON.stringify(protocol_params);
		data.json_varbind_list = JSON.stringify(getVarbindList());
		
		$.ajax({
			method: 'POST',
			url: '/device',
			data: data,
			dataType: 'text',
			success: function (id) {
				data.id = id;
				setDevice(data).click();
			}
		})
	});

	$page.on('click', '.top-menu #device-save-cancel', function() {
		var id = $page.find('#page-content #properties #id');
		var $e = $device_list.find('li#' + (id.val() || id.attr('cloned') || 0));

		return ($e.length > 0) ? $e.click() : $page.empty();
	});

	$page.on('click', '#page-device-edit #template-save', function() {
		var name = $page.find('#page-device-edit #properties #name').val();
		if (!name)
			return alert('The name is empty');

		if (templates[name] && !confirm('Overwrite?'))
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
		$table.find('#template-row').clone().removeAttr('id').appendTo($table.find('tbody'));
		highlightProtocolTabs();
	});

	$page.on('click', '#page-device-edit .varbind-list #varbind-remove', function() {
		$(this).closest('tr').remove();
		highlightProtocolTabs();	
	});

	$page.on('click', '#page-device-edit #condition-add', function() {
		$components.find('#partial-varbind-condition').clone().removeAttr('id').appendTo($(this).parent().find('#condition-list'));
	});	

	$page.on('click', '#page-device-edit #condition-remove', function() {
		$(this).parent().remove();
	});

	$page.on('click', '#page-device-edit .varbind-list #td-value', function() {
		var $row = $(this).closest('tr');
		var data = {
			protocol: $row.closest('table').attr('protocol'),
			protocol_params: {ip: $page.find('#ip').val()},
			address: {},
			divider: $row.find('#divider').val()
		}
		$row.closest('div[id^="page-"]').find('#protocol-params').find('input, select').each((i, param) => data.protocol_params[param.id] = param.value);
		$row.find('#td-address').find('input:visible, select:visible').each((i, param) => data.address[param.id] = param.value);
	
		$.ajax({
			method: 'GET',
			url: '/value',
			data: {
				json_opts: JSON.stringify(data)
			},
			success: function(res) {
				$row.find('#td-value').html(cast($row.find('#value-type').val(), res) + '<br>&#10227;')
			}
		})
	});

	$page.on('click', 'details', function() {
		var $e = $(this);
		if ($e.find('div').html())
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

	$app.on('click', '#navigator #alert-block', function() {
		if ($page.find('#alert-list').length) 
			return $page.empty();

		$.ajax({
			method: 'GET',
			url: '/alert',
			dataType: 'json',
			success: function (alerts) {
				$page.empty();
				var $component = $components.find('#page-alert-list-view').clone(true, true);				
				var $table = $component.find('#alert-list');
				$.each(alerts, (i, alert) => addAlertListTableRow($table, alert));
				$component.appendTo($page);	
			}
		})
	});

	$page.on('click', '#alert-list #td-datetime, #alert-list #td-device', function () {
		var $e = $(this).closest('tr');
		var time = new Date(parseInt($e.attr('time')));
		time.setHours(0);
		time.setMinutes(0);
		time.setSeconds(0);
		time.setMilliseconds(0);
		time = time.getTime();	
	
		$device_list.find('li#' + $e.attr('device-id')).trigger('click', {period: [time, time]});
	});

	$page.on('click', '#alert-list #td-hide', function () {
		var $e = $(this).closest('tr');
		$.ajax({
			method: 'POST',
			url: '/alert/' + $e.attr('id') + '/hide',
			dataType: 'text',
			success: () => $e.remove()
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
		if (!template)	
			return updateTemplateInfo(template_name, () => $(this).trigger('click'));
	
		var data = {
			name: $row.find('#name').val(),
			ip: $row.find('#ip').val(),
			mac: $row.find('#mac').val(),
			is_pinged: $row.find('#is-pinged:checked').length,
			period: $row.find('#period').val(),
			tags: $row.find('#tags').val(),
			description: $row.find('#description').val(),
			json_varbind_list: JSON.stringify(template),
			template: template_name
		}

		$.ajax({
			method: 'POST',
			url: '/device',
			data: data,
			success: function(id) {
				data.id = id;
				setDevice(data);
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
		$dashboard.trigger('update-graph');

		if (this.id == 'All' || $checked_list.length == 0) {
			$device_tag_list.find('input:not(#All)').attr('checked', false).prop('checked', false);
			$device_tag_list.find('#All').attr('checked', true).prop('checked', true);
			$varbind_tag_list.find('div').show();
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
		})
	});

	$dashboard.on('click', '#varbind-tag-list input', function() {
		$dashboard.find('#varbind-tag-list input:checked:not(#' + this.id + ')').removeAttr('checked');
		$dashboard.find('.history-period-block').show();
		var period = $dashboard.find('.history-period').pickmeup('get_date') || null;
		if (period && period.length > 0) 
			period = [period[0].getTime(), period[1].getTime()];
		$dashboard.trigger('update-graph', {tag: this.checked && this.id, period: period});
	});

	$dashboard.on('update-graph', function(event, data) {
		deleteGraph('dashboard');

		if (!data || !data.tag)
			return;

		$.ajax({
			method: 'GET',
			url: '/tag/' + data.tag,
			data: {
				from: data.period && data.period[0], 
				to: data.period && data.period[1],
				tags: $dashboard.find('#device-tag-list input:checked').map(function () { return this.id}).get().join(';')
			},
			success: function(res) {
				if (!res || !res.rows.length)
					return alert('No data');

				res.rows.forEach((row) => row[0] = new Date(row[0]));

				var opts = {
					animatedZooms: true,
					labels: res.columns,
					valueRange: getRange(res.rows),
					highlightCircleSize: 2,					
					height: $app.height() - $dashboard.find('#tag-list').height() - 60,
					axes: {
						x: {valueFormatter: (ms) => cast('datetime', ms)}
					},
					drawPoints: true					
				};

				if (res.ids) {
					var names = {};
					res.columns.forEach((name, i) => names[name] = res.ids[i - 1]);
					opts.drawPointCallback = function (g, seriesName, canvasContext, cx, cy, seriesColor, pointSize, row, idx) {
						var varbind_id = names[seriesName];
						var status = res.alerts[varbind_id] && res.alerts[varbind_id][g.getValue(row, 0)];
						if (!status)	
							return;
						drawCircle(canvasContext, cx, cy, status == 2 ? 'gold' : '#f00', 3);
					}
				}
			
				graphs.dashboard = new Dygraph($dashboard.find('#graph').get(0), res.rows, opts);
			}
		})
	});

	function deleteGraph(id) {
		if (graphs[id]) {
			graphs[id].destroy();
			delete graphs[id];
		}		
	}

	function updateDashboard () {
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
	
				return (!$page.html()) ? 
					$dashboard.trigger('update-graph', {tag: $dashboard.find('#varbind-tag-list input:checked').attr('id'), period: period}) :
					$page.find('#page-device-view #varbind-list').attr('period', true).trigger('update-data', {period: period});
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

	$page.on('dblclick', '.varbind-list #td-address', function() {
		var $e = $(this);
		$e.children().toggle();
	});

	$page.on('change', '.varbind-list[protocol="modbus-tcp"] #func', function() {
		var row = $(this).closest('#td-address');
		if (this.value == 'readDiscreteInputs' || this.value == 'readCoils') {
			row.find('#type').val('').attr('value', '');
			row.find('#order').val('').attr('value', '');
		} else {
			row.find('#type').val('readInt16').attr('value', 'readInt16');
			row.find('#order').val('BE').attr('value', 'BE');
		}
	});

	$app.on('click', '.history-period-value', function() {
		var $e = $(this);
		var position = $e.position();
		$e.closest('.history-period-block').find('.history-period')
			.css({top: position.top, left: position.left - 200 + $e.width(), display: 'block'})
			.pickmeup('show');
	});

	function setDevice(device) {
		var $e = $device_list.find('#' + device.id);
		if ($e.length == 0)	
			$e = $('<li/>')
				.attr('id', device.id)
				.append('<div id = "name"/>')
				.append('<div id = "ip"/>')
				.append('<div id = "mac"/>')
				.appendTo($device_list);
		
		$e.attr('title', device.description).attr('status', device.status || 0);
		$e.find('#name').html(device.name);
		$e.find('#ip').html(device.ip);
		$e.find('#mac').html(device.mac);
		return $e;			
	}

	function getRange(rows) {
		var min, max;
		rows.forEach(function (row) {
			for (var i = 1; i < row.length; i++) {
				var val = parseFloat(row[i]);
				min = (min == undefined && !isNaN(val) || !isNaN(val) && !isNaN(min) && min > val) ? val : min;
				max = (max == undefined && !isNaN(val) || !isNaN(val) && !isNaN(max) && max < val) ? val : max;
			}
		})
		var gap = (max - min) * 0.1;
		return [min - gap, max + gap];
	}

	function highlightProtocolTabs () {
		$page.find('#protocols > label').removeClass('has-varbind');
		$page.find('.varbind-list tbody:has(tr)').each(function() {
			var $e = $(this).closest('table');
			var protocol = $e.attr('protocol');
			$e.closest('#protocols').find('label[for="tab-' + protocol + '"]').addClass('has-varbind');
		})
	}

	function updateNavigatorStatus() {
		$app.find('#navigator').attr('status', Math.max.apply(null, $device_list.find('li').map((i, e) => e.getAttribute('status') || 0))); 
	}

	function addAlertListTableRow($table, alert) {
		$row = $table.find('#template-row').clone();
		$row.attr('id', alert.id).attr('status', alert.status).attr('time', alert.time).attr('device-id', alert.device_id);
		$row.find('#td-datetime').html(cast('datetime', alert.time));
		$row.find('#td-device').html(alert.device_name);
		$row.find('#td-reason').html(alert.reason);		
		$row.prependTo($table);
	}

	function updateTemplates() {
		var error = (msg) => alert('Failed load templates: ' + msg)
		$.ajax({
			method: 'GET',
			url: '/template',
			dataType: 'json',
			error: (jqXHR, textStatus, errorThrown) => error(textStatus),
			success: function (template_list) {
				var $list = $app.find('#template-list').empty();
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

	var socket;
	function connect() {
		socket = new WebSocket('ws://' + location.hostname + ':' + (parseInt(location.port) + 1));
	
		var timer = setTimeout(function() {
			alert('Connection broken. Reload page.');
			console.error(new Date() + ': Notify server disconnected. Page must be reload.');
		}, 5000);	
	
		socket.onopen = function() {
			clearTimeout(timer);
			console.log(new Date() + ': Notify server is connected.');
		};
	
		socket.onclose = function(event) {
			console.log(new Date() + ': Notify server is disconnected.');
			setTimeout(connect, 1000);
		};
	
		socket.onerror = function(error) {
			// console.log(error.message);
		};
	
		socket.onmessage = function(event) {
			var packet = JSON.parse(event.data);

			if (packet.event == 'access') {
				if (packet.access == 'view')
					$components.find('#page-alert-list-view #alert-list #td-hide').remove();

				if (packet.access == 'edit') {
					$('.top-menu').attr('admin', true);
					updateTemplates();
				}
				return;
			}
			
			if (packet.event == 'status-updated') {
				$device_list.find('li#' + packet.id).attr('status', packet.status || 0);
				updateNavigatorStatus();
				return;	
			}

			if (packet.event == 'alert-summary') {
				var $alert_block = $app.find('#navigator #alert-block');
				$alert_block.find('#warning').html(packet.warning);
				$alert_block.find('#critical').html(packet.critical);
				return;
			}

			if (packet.event == 'alert-info') {
				var $table = $page.find('#alert-list');
				if (!$table.length)
					return;

				addAlertListTableRow($table, packet);
				return;
			}

			if (packet.event == 'values-changed') {
				var $varbind_list = $page.find('#varbind-list');
				if (!$varbind_list.length || $varbind_list[0].hasAttribute('period'))
					return;

				var time = new Date(packet.time);
				var hour = 1000 * 60 * 60;
				$.each(packet.values, function(i, varbind) {
					var $row = $varbind_list.find('tr#' + varbind.id);
					if ($row.length == 0)
						return;

					$row.find('#td-value')
						.html(cast(varbind.value_type, varbind.value))
						.attr('status', varbind.status)
						.attr('title', cast('datetime', packet.time));

					if (varbind.value_type == 'number') {
						var val = parseFloat(varbind.value);
						var graph = graphs[varbind.id];
						if (!graph)
							return;

						var data = graph.file_;
						var range = graph.user_attrs_.valueRange;

						data = data.filter((e) => e[0].getTime() + hour > packet.time);
						data.push([time, val || varbind.value]);

						if (varbind.status == 2 || varbind.status == 3)
							graph.alerts[packet.time] = varbind.status;

						if (!isNaN(val) && (val < range[0] || val > range[1])) 
							range = getRange(data);

						graph.updateOptions({file: data, valueRange: range});
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
							createHistoryTableRow(last_event, varbind.value_type).appendTo($table);
					}
				})
			}	
		};
	}
	connect();

	$(document).ajaxSend(function(event, request, settings) {
		try {
			socket.send(settings.url);
		} catch(err) {}
	});

	$.ajaxSetup({
		error: function(jqXHR, textStatus, errorThrown) {
			console.log(jqXHR, textStatus, errorThrown);
			alert(jqXHR.responseText || errorThrown);
		}
	});
	
	$(document).ajaxComplete(function(event, req, settings) {
		$('#app').css('cursor', 'initial');

		if (req.status != 200)
			return;

		if (settings.url == '/device' && settings.method == 'POST')
			return updateDashboard();

		if (settings.url.indexOf('/device/') == 0 && settings.method == 'DELETE')
			return updateDashboard();

		if (/^\/device\/([\d]*)\/varbind-history$/.test(settings.url)) 
			$app.find('#device-history-period').pickmeup('set_date', new Date());

		if (settings.url.indexOf('/template/') == 0 && (settings.method == 'POST' || settings.method == 'DELETE'))	
			updateTemplates();
	});
	
	$(document).ajaxStart(function() {
		$('#app').css('cursor', 'wait');
	});

	function drawCircle(ctx, x, y, color, size) {
		ctx.beginPath();
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		ctx.arc(x, y, size || 1, 0, 2 * Math.PI, false);
		ctx.fill();
		ctx.stroke();
	}

	function cast(type, value, args) {
		type = (type + '').toLowerCase();
	
		if (!type)
			return value;
	
		if (value == null || value == undefined)
			return '';
	
		if(type == 'string')
			return value + '';
	
		if (type == 'number' && !isNaN(value)) {
			var factor = Math.pow(10, 2); // 2 digit after .
			return Math.round(value * factor) / factor;
		}	
	
		if ((type == 'time' || type == 'date' || type == 'datetime') && !isNaN(value) && !!value) {
			var datetime = {
				datetime : "%d.%m.%Y %H:%M",
				date : "%d.%m.%Y",
				time : "%H:%M",		
				pickmeup: "d.m.Y"
			}
			return strftime(datetime[type], new Date(parseInt(value) || value));
		}
	
		if (type == 'filesize' && !isNaN(value)) {
			var i = Math.floor(Math.log(value) / Math.log(1024));
			return (value / Math.pow(1024, i)).toFixed(2) * 1 + ['B', 'kB', 'MB', 'GB', 'TB'][i];		
		}
	
		if (type == 'onoff') 
			return ['On', 'Off'][parseInt(value) ? 0 : 1];
	
		if (type == 'yesno') 
			return ['Yes', 'No'][parseInt(value) ? 0 : 1];
		
		if (type == 'duration' && !isNaN(value)) {
			var min = 6000;
			var mhd = [Math.floor((value/min % 60)), Math.floor((value/(60 * min)) % 24), Math.floor(value/(24 * 60 * min))];
			var txt = ['m','h','d'];
			var res = (mhd[2] ? mhd[2] + txt[2] + ' ' : '') + (mhd[1] ? mhd[1] + txt[1] + ' ' : '') + ((args != 'short' || mhd[0]) ? mhd[0] + txt[0] : '');
			return res.trim();
		}
	
		return value;
	}
});