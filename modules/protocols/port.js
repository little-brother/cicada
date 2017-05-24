'use strict'
const spawn = require('child_process').spawn;

// opts = {ip: 127.0.0.1}
// address = {port: 80, protocol: 'tcp'}
exports.getValues = function (opts, address_list, callback) {
	function check(protocol, callback) {
		let ports = address_list.filter((a) => a.protocol == protocol).map((a) => a.port).join(',');
		if (!ports)
			return callback(null, '');
	
		let stdout = '';
		let stderr = '';
		let params = (protocol == 'tcp') ? ['-p', ports, opts.ip] : ['-sU', '-p', ports, opts.ip];
		let proc = spawn('nmap', params);
		proc.stdout.on('data', (data) => stdout += data + '');
		proc.stderr.on('data', (data) => stderr += data + '');
		proc.on('close', (code) => {
			if (code)		
				return callback(new Error(code + ' ' + stderr + ' with ' + params.join(' ')));
			callback(null, stdout);
		})
	}

	let outputs = [];
	function onDone(err, stdout) {
		outputs.push(err || stdout);

		if (outputs.length == 1)
			return;

		if (outputs[0] instanceof Error || outputs[1] instanceof Error)
			return callback(outputs[0] || outputs[1]);

		let res = [];
		let data = outputs.join('\n').replace(/(?:\r\n|\r|\n)/g, ' ');

		address_list.forEach(function(address) {
			let pp = address.port + '/' + address.protocol;
			let re = new RegExp(pp + '(\\s*)open*');
			res.push({
				value: re.test(data) ? 1 : 0,
				isError: false
			});
		})
		
		callback(null, res);
	}
	
	check('tcp', onDone);
	check('udp', onDone);
}

// ???
exports.doAction = function(opts, action, callback) {
	callback(null);
}