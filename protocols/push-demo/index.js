'use strict'
const net = require('net');
let cache = {};

function  start() {
	let server = net.createServer(function (socket) {
		let msg = '';
		socket.on('error', (err) => console.error(err));
		socket.on('data', function (data) {
			msg += data.toString();
			if (msg.indexOf('\n') == -1)
				return;

			let items = msg.split(' ');
			msg = '';

			if (items.length < 3)			
				return;

			let ip = items[0];
			if (!cache[ip])
				cache[ip] = {};

			cache[ip][items[1]] = items[2]; 
		});
	})
	
	server.on('error', (err) => console.error(err));
	server.on('close', () => setTimeout(start, 1000));

	server.listen(6000);
}
start();

// opts = {ip: 127.0.0.1}
// address = {item: 'CPU'}
exports.getValues = function(opts, address_list, callback) {
	console.log(cache, opts, address_list)
	let data = cache[opts.ip];
	if (!data)
		return callback(new Error('No data'));

	let res = address_list.map((a) => new Object({value: data[a.item], isError: false}));
	callback(null, res);
}