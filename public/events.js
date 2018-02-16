$(function() {
	var $body = $('body');	
	var $app = $('.app');

	if (getCookie('access') == 'edit')
		$('.top-menu').attr('admin', true);
	
	var socket;
	var subscription = {device_id: 0, diagram_id: 0};

	function connect() {
		try {
			socket = new WebSocket('ws://' + location.hostname + ':' + (parseInt(location.port) + 1));
		} catch (err) {
			console.error(err);
			alert('Websocket disabled: ' + err.message);
			return;
		}
	
		var timer = setTimeout(function() {
			alert('Connection broken. Reload page.');
			console.error(new Date() + ': Notify server disconnected. Page must be reload.');
			location.reload();
		}, 10000);	
	
		socket.onopen = function() {
			clearTimeout(timer);
			console.log(new Date() + ': Notify server is connected.');
			$app.trigger('notify', subscription);
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
			$app.trigger(packet.event, packet);
		}
	}
	connect();

	$body.on('keydown', function (event) {
		// Ctrl + Alt + L: Go to to login page
		if (event.ctrlKey && event.altKey && event.keyCode == 76) {	 
			window.location = '/login';
		}

		// Ctrl + Alt + S: Show statistic
		if (event.ctrlKey && event.altKey && event.keyCode == 83) {	 
			var $e = $('<a/>').attr('href', '/stats').attr('target', '_blank').appendTo($body); // FF fix
			$e[0].click();
			$e.remove();
		}
	});

	$app.on('notify', function (event, data) {
		try {
			socket.send(JSON.stringify(data));

			if (data.device_id)
				subscription.device_id = data.device_id;
			if (data.diagram_id)
				subscription.diagram_id = data.diagram_id;
		} catch(err) {}

		$(window).trigger('save-state', data.device_id ? data.device_id : data.diagram_id);
	});

	var clickTimeStamp = 0;
	$(window).on('click auxclick', function (event) {
		if (event.which != 2)
			return;
		
		// FF56 bug fix
		if (clickTimeStamp == event.timeStamp)
			return;	
		clickTimeStamp = event.timeStamp; 

		event.stopImmediatePropagation();
		$(window).trigger('toggle-app');
	});
	
	$(window).on('popstate', function (event) {
		var state = event.originalEvent.state;
		if (!state) 
			return;

		if ($app.filter('.current').attr('id') != state.app)
			$(window).trigger('toggle-app');

		var $current = $app.filter('.current');
		if (state && state.id) 
			return $current.find('#navigator li#' + state.id).trigger('click');

		$current.find('#page-close').trigger('click');
	});

	$(window).on('toggle-app', function () {
		$app.toggleClass('current');
		$(window).trigger('save-state', $app.filter('.current').find('#navigator li.active').attr('id'));
	});

	$(window).on('save-state', function (event, id) {
		id = id || 0;
		var current = $app.filter('.current').attr('id');
		if (history.state && history.state.app == current && (history.state.id || 0) == id)
			return;

		history.pushState({app: current, id}, 'Cicada', '/');
	});

	$.ajaxSetup({
		error: function(jqXHR, textStatus, errorThrown) {
			console.log(jqXHR, textStatus, errorThrown);
			alert(jqXHR.responseText || errorThrown);
		}
	});
	
	$(document).ajaxComplete(function(event, req, settings) {
		if ($.active <= 1) // one active request is websocket
			$app.css('cursor', 'initial');

		if (req.status == 200)
			$app.trigger('ajax-complete', settings);
	});
	
	$(document).ajaxStart(function() {
		$app.css('cursor', 'wait');
	});	
});