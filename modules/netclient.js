'use strict'
const net = require('net');

function netClient(host, port) {
	this.host = host || '127.0.0.1';
	this.port = parseInt(port) || 8000;
	this.queue = [];
	this.buffer = '';	
	this.ondata = () => null;
	this.socket = this.connect();
}

netClient.prototype.on = function (event, f) {
	this['on' + event] = f;
}

netClient.prototype.connect = function () {
	let client = this;
	client.is_busy = true;
	client.connected = false;

	let socket = new net.Socket();
	socket.connect(client.port, client.host, function () {
		client.connected = true;
		client.is_busy = false;
		console.log(`Connected to anomaly detector (${client.host}:${client.port})`);
		client.next();
	});	

	socket.on('data', function (data) {
		client.buffer += data.toString();
		if (client.buffer.indexOf('\n') == -1)
			return;

		let queue = client.buffer.split('\n');
		client.buffer = queue.pop();
		queue.forEach((packet) => client.ondata(packet.split(';')));		
	});

	socket.on('error', (err) => null);
	socket.on('close', function () {
		if (client.connected)
			console.log(`Disconnected from anomaly detector (${client.host}:${client.port})`);
		client.connected = false;
		client.is_busy = true;
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
		this.queue = queue.slice(queue.length - 1000);
	}
	
	this.next();
}

netClient.prototype.next = function () {
	let client = this;
	let queue = this.queue;

	if (client.is_busy)
		return;

	if (queue.length == 0 || !client.socket) {
		client.is_busy = false;
		return;
	}

	let packet = queue.shift();
	client.socket.write(packet, () => client.next());
}

module.exports = netClient;