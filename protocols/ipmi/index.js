'use strict'
const exec = require('child_process').exec;
const spawn = require('child_process').spawn;

let is_enable = false;
exec('ipmitool -V', (err) => is_enable = !err || !console.log('IPMI is not available'));

// opts = {ip: 127.0.0.1, user: Home, password: 'kitty', interface: lan1, timeout: 3}
// address = {sensor: 'Fan3', get: value}
exports.getValues = function(opts, address_list, callback) {
	if (!is_enable)
		return callback(new Error('Require IPMItool package'));

	if (address_list.some((a) => !a.oid))
		return callback(new Error('Sensor is empty!'));

	let params = [
		'sdr',
		'-H', opts.ip,
		'-U', opts.user,
		'-P', opts.password
	];

	params = params.concat((opts.interface) ? ['-I', opts.interface] : [], address_list.map((a) => a.sensor));

	let stdout = '';
	let stderr = '';	
	let proc = spawn('ipmitool', params);
	proc.stdout.on('data', (data) => stdout += data + '');
	proc.stderr.on('data', (data) => stderr += data + '');
	proc.on('close', (code) => {
		if (code)		
			return callback(new Error(code + ' ' + stderr + ' with ' + params.join(' ')));

		let data = {};
		stdout.split(/\r?\n/)
			.filter((row) => !!row)
			.map((row) => row.split('|').map((e) => e.trim()))
			.forEach((row) => data[row[0]] = {value: parseInt(row[1]), status: row[2] || ''});

		let res = address_list.map((a) => new Object({
				isError: !data[a.sensor], 
				value: data[a.sensor] ? data[a.sensor][a.get] : 'Not found'
		}));				
		
		callback(null, res);	
	});
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}