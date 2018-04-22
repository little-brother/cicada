// Protocol details: https://www.zabbix.org/wiki/Docs/protocols/zabbix_agent/2.0
// Supported items: https://www.zabbix.com/documentation/2.0/manual/appendix/items/supported_by_platform

'use strict'
const net = require('net');

// opts = {ip: localhost, port: 10050, timeout: 3}
// address = {item: system.cpu.load}
exports.getValues = function(opts, address_list, callback) {	
	let res = new Array(address_list.length);

	function parseData(data) {
	    let header, check, length;

	    if (data.length < (4 + 1 + 8 + 1)) 
	        return new Error("Incorrect response size: " + data.toString());
	
	    header = data.slice(0, 4).toString();
	    check  = data[4];
	    if (header != "ZBXD" || data[4] != 0x01)
	        return new Error("Incorrect header: " + header + ":" + check);
	
	    length = data.readUInt32LE(5);
	    if (data.length != (4 + 1 + 8 + length))
	        return new Error("Incorrect length: " + length);

		let value = data.slice(data.length - length).toString();
		return value == 'ZBX_NOTSUPPORTED' ? new Error('ZBX_NOTSUPPORTED') : value;
	}

	function getValue(i) {
		if (i == address_list.length) 
			return callback(null, res);

		let socket = net.createConnection(opts.port || 10050, opts.ip || '127.0.0.1');
		let buffer = Buffer.from([]);
		let error;
		socket.setTimeout(opts.timeout * 1000 || 3000);
		socket.on('error', (err) => error = err);
		socket.on('data', (data) => buffer = Buffer.concat([buffer, data]));
		socket.on('close', function () {
			if (error && i == 0 && error.code == 'ECONNREFUSED')
				return callback(new Error('ECONNREFUSED'));
	
			let value = error || parseData(buffer);
			let isError = value instanceof Error;		
			res[i] = {value: (isError) ?  value.message : value, isError};	

			getValue(i + 1);
		});
		socket.on('connect', () => socket.write(address_list[i].item + '\n'));
	}

	getValue(0);
}

// opts = {ip: localhost, port: 10050, timeout: 3}
// enum_list = [system.cpu.discovery, net.if.discovery]
exports.discovery = function (opts, enum_list, callback) {
	let res = new Array(enum_list.length);

	function enumItem (i) {
		if (i == enum_list.length) 
			return callback(null, res);

		let e = enum_list[i];
		exports.getValues(opts, [{item: e}], function (err, values) {
			if (err && err.message == 'ECONNREFUSED')
				return callback(new Error('The Zabbix agent is not available'));
	
			let element_list;

			try {
				element_list = !err ? JSON.parse(values[0].value).data : [];
			} catch (error) {
				err = error;
			} 

			res[i] = err || !(element_list instanceof Array) ? [] : element_list;
			enumItem (i + 1);
		});
	}
	enumItem(0);	
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}