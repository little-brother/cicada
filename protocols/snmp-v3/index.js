'use strict'
const exec = require('child_process').exec;
const spawn = require('child_process').spawn;

let is_enable = false;
exec('snmpgetnext -V', (err) => is_enable = !err || !console.log('SNMP v3 is not available'));

// opts = {ip: 127.0.0.1, port: 161, user: Home, context: '', security_level: authNoPriv, auth_protocol: MD5, auth_password: somekey, timeout: 3}
// address = {oid: 1.3.6.1.2.1.1.3.0}
exports.getValues = function(opts, address_list, callback) {
	if (!is_enable)
		return callback(new Error('Require Net-SNMP package'));

	if (address_list.some((a) => !a.oid))
		return callback(new Error('Oid is empty!'));

	let params = [
		'-v', 3,
		'-n', opts.context || '',
		'-u', opts.user,
		'-l', opts.security_level	 
	];

	if (opts.security_level == 'authNoPriv')
		params = params.concat('-a', opts.auth_protocol, '-A', opts.auth_password);

	if (opts.security_level == 'authPriv')
		params = params.concat('-x', opts.priv_protocol, '-X', opts.priv_password);

	params = params.concat(opts.ip, address_list.map((a) => a.oid));

	let stdout = '';
	let stderr = '';	
	let proc = spawn('snmpgetnext', params);
	proc.stdout.on('data', (data) => stdout += data + '');
	proc.stderr.on('data', (data) => stderr += data + '');
	proc.on('close', (code) => {
		if (code)		
			return callback(new Error(code + ' ' + stderr + ' with ' + params.join(' ')));

		let lines = stdout.split(/\r?\n/).filter((l) => !!l);
		if (lines.length != address_list.length)	
			return callback(new Error(`Result is a not valid. Require: ${address_list.length}, received: ${lines.length} rows.`));

		let res = lines.map(function (line) {
			let val = line.match(/(?:.*) = (\w+\:|.*)?(\(([\d]*)\)|.*)/) || [];
			return {
				isError: !val[3] && !val[2],
				value: val[3] || val[2] || val[1] || line
			}
		});

		callback(null, res);	
	});
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}