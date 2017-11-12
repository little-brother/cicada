$(function() {
	var $window = $(window);
	var $body = $('body');	
	var $app = $('.app');

	if (getCookie('access') == 'edit')
		$('.top-menu').attr('admin', true);
	
	var socket;
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
		if ($.active <= 1) // one active request is websocket
			$window.css('cursor', 'initial');

		if (req.status == 200)
			$app.trigger('ajax-complete', settings);
	});
	
	$(document).ajaxStart(function() {
		$window.css('cursor', 'wait');
	});	
});