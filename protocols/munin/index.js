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
	socket.setTimeout(opts.timeout * 1000 || 3000);

	socket.on('data', function (chunk) {
		function next() {
			text = '';
			group = groups.pop();
			socket.write(group == 'list' ? 'list\n' : `fetch ${group}\n`);
		}

		text += chunk.toString();
		if (text.indexOf('# munin node at') == 0)
			return next();
		
		if (group != 'list' && text.indexOf('\n.') == -1)//(text.indexOf('\n.') - text.length == 3)
			return;

		if (group == 'list' && text.indexOf('\n') == -1)
			return;

		data[group] = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length && line != '.');

		if (groups.length)
			return next();

		res = address_list.map(function(address) {
			let item = (address.item || '').trim();

			if (!item)
				return {isError: false, value: data[address.group].join('\n')};

			let value = data[address.group]
				.filter((row) => row.indexOf(item + '.value') == 0)
				.map((row) => row.substring(item.length + 7))[0];

			return (value == undefined) ? {isError: true, value: 'Not found'} : {isError: false, value};
		});

		socket.end('quit');
	});

	socket.on('close', function () {
		callback(error || !res && new Error('No access'), res)
	});	
	
	socket.on('error', function (err) {
		error = err;
	});

	socket.on('timeout', function () {
		error = new Error('Timeout');
		socket.destroy();
	});
}


exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}