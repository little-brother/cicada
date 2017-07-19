// Protocol details: http://guide.munin-monitoring.org/en/latest/master/network-protocol.html#network-protocol

'use strict'
const net = require('net');

// opts = {ip: localhost, port: 4949, node: timeout: 3}
// address = {group: cpu, item: cpu_user}
exports.getValues = function (opts, address_list, callback) {
	let groups = address_list.map((address) => address.group).filter((e, i, arr) => arr.indexOf(e) == i).filter((g) => !!g);
	if (!groups.length)
		return callback(new Error('No group specified'));

	let error, group, res;
	let data = {};
	let text = '';

	let socket = net.createConnection(opts.port || 4949, opts.ip || '127.0.0.1');
	socket.on('error', (err) => error = err);
	socket.on('data', function (chunk) {
		function next() {
			text = '';
			group = groups.pop();
			socket.write(`fetch ${group}\n`);
		}

		text += chunk.toString();
		if (text.indexOf('# munin node at') == 0)
			return next();
		
		if (text.indexOf('\n.') - text.length == 3)
			return;

		data[group] = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length && l != '.');
		if (groups.length)
			return next();

		res = address_list.map(function(address) {
			if (!address.item)
				return {isError: false, value: data[address.group].join('\n')};

			let value = data[address.group]
				.filter((row) => row.indexOf(address.item + '.value' == 0))
				.map((row) => row.substring((address.item + '.value').length + 1))[0];

			return (value == undefined) ? {isError: true, value: 'Not found'} : {isError: false, value};
		});

		socket.end('quit');
	});
	socket.on('close', () => callback(error, res));	
	socket.setTimeout(opts.timeout * 1000 || 3000);

	setTimeout(function () {
			error = new Error('Timeout');
			socket.end('quit')
		}, opts.timeout * 1000 || 3000
	);
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}