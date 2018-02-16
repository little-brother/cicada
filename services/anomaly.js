'use strict'
const net = require('net');
const Varbind = require('../models/varbind');
const events = require('../modules/events');

function start(config) {
	let list = config['anomaly-detector'];
	if (!list || !(list instanceof Object)) 
		return events.on('new-connection', (sender) => sender({event: 'no-anomaly-detector'}));

	if (!(list instanceof Array))
		list = [list];
	
	list.forEach(function (opts) {
		let tag_list = opts['tag-list'] instanceof Array && opts['tag-list'] || opts.tags && (opts.tags || '').split(';').map((e) => (e || '').trim()) || [];
		if (tag_list.length == 0)
			return console.error(__filename, 'Tags is required');
	
		let detector = new netClient(opts.host, opts.port, function (packet) {
			let id = parseInt(packet[0]);
			let varbind = Varbind.get(id);
			if (!varbind)	 
				return;

			if (!isNaN(packet[1])) {
				let time = parseInt(packet[1]);
				let description = packet[2];

				events.emit('anomaly', {varbind, description}, time); // see alerter.js
				return; 
			}

			if (packet[1] == 'HISTORY') {
				let from = parseInt(packet[2]);
				let to = parseInt(packet[3]);

				if (isNaN(from) || isNaN(to) || from >= to)				
					return console.error(__filename, 'Bad history request: ', JSON.stringify(packet));

				varbind.getParent().getHistory([from, to], id, false, function (err, history) {
					if (err)
						return console.error(__filename, err.message, 'with packet: ' + JSON.stringify(packet));

					let alerts = history.alerts[id] || {};
					let rows = (history.rows || []).map((e, i) => alerts[e[0]] ? [e[0], 'ANOMALY'] : e);

					detector.send([varbind.id, 'HISTORY', rows.map((e) => e.join(';')).join(';')]);
				});

				return;
			}
		});
	
		let cache = {}; //idx is device id
		events.on('values-updated', function (device, time) {
			if (!cache[device.id])
				cache[device.id] = device.varbind_list.filter((v) => v.value_type == 'number' && v.tag_list.some((t) => tag_list.indexOf(t) != -1)) || [];
	
			cache[device.id].forEach((varbind) => detector.send([varbind.id, time, varbind.value]));
		});
	});	
}

module.exports = start;


// simple buffered net-client
function netClient(host, port, onData) {
	this.host = host || '127.0.0.1';
	this.port = parseInt(port) || 8000;
	this.queue = [];
	this.buffer = '';	
	this.onData = (onData) ? onData : () => null;

	this.socket = this.connect();
}

netClient.prototype.connect = function () {
	let client = this;
	client.is_busy = false;
	client.connected = false;

	let socket = new net.Socket();
	socket.connect(client.port, client.host, function () {
		client.connected = true;
		console.log(`Connected to anomaly detector (${client.host}:${client.port})`);
		client.next();
	});	

	socket.on('data', function (data) {
		client.buffer += data.toString();
		if (client.buffer.indexOf('\n') == -1)
			return;

		let queue = client.buffer.split('\n');
		client.buffer = queue.pop();
		queue.forEach((packet) => client.onData(packet.split(';')));		
	});

	socket.on('error', (err) => null);

	socket.on('close', function () {
		if (client.connected)
			console.log(`Disconnected from anomaly detector (${client.host}:${client.port})`);
		client.connected = false;
		client.socket = null;
		socket.destroy();

		setTimeout(() => client.socket = client.connect(), 2000);
	});
	
	return socket;
}

netClient.prototype.send = function (packet) {
	let queue = this.queue;	

	queue.push(packet.join(';') + '\n');

	if (queue.length > 10000) {
		console.log(__filename, 'Buffer overflow detected... Trimmed to 1000 values.');
		queue = queue.slice(queue.length - 1000);
	}
	
	this.next();
}

netClient.prototype.next = function () {
	let client = this;
	let queue = this.queue;

	if (client.is_busy)
		return;

	if (queue.length == 0 || !client.socket)
		return (client.is_busy == false);

	let packet = queue.shift();
	client.socket.write(packet, () => client.next());
}