'use strict'
const net = require('net');

// opts = {ip: localhost, port: 6556, encoding: utf8, timeout: 3}
// address = {section: check_mk, pattern: Architecture: ([\d]*)bit*}
exports.getValues = function(opts, address_list, callback) {
	let buffer = Buffer.from([]);
	let error;

	let socket = net.createConnection(opts.port || 6556, opts.ip || '127.0.0.1');
	socket.setTimeout(opts.timeout * 1000 || 3000);
	socket.on('error', (err) => error = err);
	socket.on('data', (data) => buffer = Buffer.concat([buffer, data]));
	socket.on('close', function () {		
		if (error)
			return callback(error);
		
		let text = buffer.toString(opts.encoding || 'utf8');
		let lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);

		let data = {};
		let section = '';
		lines.forEach(function (line) {
			if (line.indexOf('<<<') == -1)
				return data[section].push(line);
				
			section = line.slice(3, -3);
			data[section] = [];
		});

		let pattern_list = address_list.map(function (address) {
			try {
				return new RegExp(address.pattern)	
			}
			catch (err) {
				console.error(__filename, err);
			}
		});

		let res = address_list.map(function(address, idx) {
			if (!data[address.section])
				return {value: 'Unsupported', isError: true};

			let value;
			for (let i = 0; i < data[address.section].length; i++) {
				if (!pattern_list[idx])	
					continue;

				value = value || (data[address.section][i].match(pattern_list[idx]) || [])[1];
				if (!isNaN(value) || !!value)
					break;
			}
			return {value: value || '', isError: false};
		})
		callback(null, res);
	});
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}