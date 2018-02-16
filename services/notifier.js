'use strict'
const WebSocket = require('ws');
const events = require('../modules/events');
const Diagram = require('../models/diagram');

function start(config) {
	let	wss = new WebSocket.Server({ 
		port: parseInt(config.port || 5000) + 1,
		clientTracking: true
	});
	
	wss.on('connection', function (ws, req) {
		ws.on('message', function (msg) {
			try {
				let data = JSON.parse(msg);
				if (data.device_id)
					ws.device_id = parseInt(data.device_id) || 0;

				if (data.diagram_id)
					ws.diagram_id = parseInt(data.diagram_id) || 0;
			} catch (err) {
				console.error(__filename, err);
			}
		});

		function sender (packet) {
			try {
				ws.send(JSON.stringify(packet));
			} catch (err) { }
		}
		events.emit('new-connection', sender);
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
		let packet = {event: 'values-updated', id: device.id, status: device.status, values, latency: device.latency, time};
		broadcast(packet, (client) => client.device_id == device.id);

		Diagram.getList()
			.filter((diagram) => !!diagram.devices[device.id])
			.forEach(function (diagram) {
				broadcast(packet, (client) => client.diagram_id == diagram.id);

				diagram.updateStatus();
				broadcast({event: 'diagram-status-updated', id: diagram.id, status: diagram.status, time});
			});	
	});
	
	events.on('status-updated', function(device, time) {
		let packet = {event: 'status-updated', id: device.id, status: device.status, alive: device.alive, time}
		broadcast(packet);
	});
	
	events.on('broadcast', broadcast);
}

module.exports = start;