'use strict'
const spawn = require('child_process').spawn;

// opts = {ip: 127.0.0.1}
// address = {port: 80, protocol: 'tcp'}
exports.getValues = function (opts, address_list, callback) {
	let res = [];
	
	let stdout = '';
	let stderr = '';	
	let proc = spawn('nmap', ['-Pn -p ' + address_list.map((a) => a.port).join(','), opts.ip]);
	proc.stdout.on('data', (data) => stdout += data + '');
	proc.stderr.on('data', (data) => stderr += data + '');
	proc.on('close', (code) => {
		if (code)		
			return callback(new Error(code + ' ' + stderr + ' with ' + params.join(' ')));
		let data = stdout.replace(/(?:\r\n|\r|\n)/g, ' ');

		address_list.forEach(function(address) {
			let pp = address.port + '/' + address.protocol;
			let re = new RegExp(pp + '(\\s*)open*');
			res.push({
				value: re.test(data) ? 1 : 0,
				isError: false
			});
		})
		
		callback(null, res);
	});
}

// ???
exports.doAction = function(opts, action, callback) {
	callback(null);
}