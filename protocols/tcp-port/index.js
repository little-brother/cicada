'use strict'
const net = require('net');


// opts = {ip: 127.0.0.1, timeout: 3}
// address = {port: 80}
exports.getValues = function (opts, address_list, callback) {
	let res = [];
	
	function getValue(i) {
		if (i == address_list.length) 
			return callback(null, res);

		let value;
		let isError = false;

		let port = parseInt(address_list[i].port);
		if (isNaN(port) || port < 0 || port > 65535) {
			res.push({value: 'port should be >= 0 and < 65536: ' + address_list[i].port, isError: true});
			return getValue(i + 1);
		}
			
		let socket = new net.Socket();
		
		socket.on('connect', function () {
			value = 1;
			socket.destroy();
		});
		
		socket.setTimeout(parseInt(opts.timeout) * 1000 || 3000);
		socket.on('timeout', function () {
			value = 0;
			socket.destroy();
		});
		
		socket.on('error', function (err) {
			if (err.code !== 'ECONNREFUSED') {
				isError = true;
				value = err.message;
			} else {
				value = 0;
			}
		});
		
		socket.on('close', function (err) {
			res.push({value, isError});
			getValue(i + 1);
		});
		
		socket.connect(port, opts.ip);
	}

	getValue(0);
}

// ???
exports.doAction = function(opts, action, callback) {
	callback(null);
}