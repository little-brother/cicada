'use strict'
const WebSocket = require('ws');
const events = require('../modules/events');

function start(config) {
	let	wss = new WebSocket.Server({ 
		port: parseInt(config.port || 5000) + 1,
		clientTracking: true
	});
	
	wss.on('connection', function (ws, req) {
		ws.on('message', function (msg) {
			ws.device_id = (/device\/([\d]*)/g).test(msg) ? parseInt(msg.substring(8)) : 0;
		});

		events.emit('new-connection', ws);
	});
	
	function broadcast(packet, filter) {
		if (!wss || !wss.clients)
			return;
	
		wss.clients.forEach(function(client) {
			if (filter && !filter(client))
				return;
			
			try {
				if (packet)	
					client.send(JSON.stringify(packet));
				else
					client.ping('ping');	
			} catch (err) {}
		})
	}
	
	setInterval(function () {
		broadcast(null, (client) => client.readyState == WebSocket.OPEN)
	}, 10000);
	
	events.on('values-updated', function (device, time) {
		let values = device.varbind_list.map((v) => new Object({id: v.id, prev_value: v.prev_value, value: v.value, value_type: v.value_type, status: v.status || 0}));
		let packet = {event: 'values-updated', id: device.id, values, time}
		broadcast(packet, (client) => client.device_id == device.id);	
	});
	
	events.on('status-updated', function(device, time) {
		let packet = {event: 'status-updated', id: device.id, status: device.status, time}
		broadcast(packet);
	});
	
	events.on('broadcast', broadcast);
}

module.exports = start;