'use strict'
const net = require('net');
const CRLF = '\r\n';

// opts = {ip: 127.0.0.1, user: Home, password: 'kitty', port: 21, timeout: 3}
// address = {filename: '/test/file.jpg'}
exports.getValues = function(opts, address_list, callback) {
	let command_list = [
		'USER ' + opts.user, 
		'PASS ' + opts.password,
		'' // 500 reply
	];

	address_list.forEach((a) => command_list.push('SIZE ' + a.filename));
	command_list.push('QUIT');
	
	let buffer = '';
	let error;
	let command_no = 0;

	let socket = new net.Socket();
	socket.connect(opts.port || 21, opts.ip);
	
	socket.on('data', function(data) {
		let chunk = data.toString();
		buffer += chunk;
	
		if (buffer.indexOf('530 ') != -1) {
			error = new Error('Auth');
			socket.end();
			return;
		}
	
		if (buffer.indexOf('221 ') != -1)
			return socket.end();
		
		if (command_no < command_list.length) {
			socket.write(command_list[command_no] + '\n');
			command_no++;
		}	
	});
	
	socket.setTimeout(opts.timeout || 3000);
	socket.on('timeout', () => error = new Error('Timeout'));	
	socket.on('close', function () {
		if (error) 
			return callback(error);

		let line_list = buffer.split('\n').map((line) => (line + '').trim());		
		line_list = line_list.slice(line_list.findIndex((line) => line.indexOf('500 ') == 0) + 1);

		let res = [];
		for (let i = 0; i < address_list.length; i++) {
			let size = parseInt(line_list[i].replace(/^\d+/, '').trim());
			res.push({isError: false, value: !isNaN(size) ? size : -1});
		}

		callback(null, res);	
	});
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}