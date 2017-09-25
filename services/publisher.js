'use strict'
const net = require('net');
const events = require('../modules/events');

function start (config) {
	let opts = config.publisher;
	if (!opts)
		return;

	let clients = [];

	function start (config) {
		function onConnect (socket) {
			clients.push(socket);
			socket.on('error', (err) => console.error (__filename, err.message));
			socket.on('end', function () {
				clients.splice(clients.indexOf(socket), 1);
				if (opts.host)
					start(config);
			});
		}

		if (!opts.host)
			net.createServer(onConnect).listen(opts.port || (parseInt(config.port) + 2) || 5002);
		else
			net.createConnection(opts.host, opts.port || 2003, onConnect);
	}
	start(config);		

	events.on('values-updated', function (device, time) {
		clients.forEach(function (socket) {
			device.varbind_list.forEach(function(varbind) {
				if (varbind.is_temporary || !!opts['only-numeric'] && varbind.value_type != 'number')
					return;

				try {
					socket.write((opts.pattern ? eval(`\`${opts.pattern}\``) : device.name + '/' + varbind.name + ' ' + varbind.value + ' ' + time) + (opts.EOL || '\r\n'));
				} catch (err) {
					console.error(__filename, err);
				}
			});
		});
	});	
}

module.exports = start;
