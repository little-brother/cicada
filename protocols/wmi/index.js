'use strict'
const exec = require('child_process').exec;

let is_enable = false;
exec('wmic /?', (err) => is_enable = !err || !console.log('WMI is not available'));

// opts = {user: Home, password: mypassword, ip: localhost, timeout: 3}
// address = {alias: cpu, property: caption}
exports.getValues = function(opts, address_list, callback) {
	if (!is_enable)
		return callback(new Error('Require WMIC'));

	let res = new Array(address_list.length);

	function parseValue(value, format) {
		let res = [];

		let row = [];
		let lines = (value + '').split('\n').map((line) => (line + '').trim());
		lines.forEach(function(line, i) {
			if (i == lines.length - 1 || !line && !!lines[i - 1]) {
				res.push(row);
				row = [];
				return;
			}

			if (!line)
				return;

			let pair = line.split('=');
			let val = (pair[1] + '').trim();
			if (val != '')
				row.push(val);
		});

		return res.filter((row) => !!row.length).map((row) => row.join(' ')).join('\n');
	}

	function getValue(i) {
		if (i == address_list.length) 
			return callback(null, res);

		let auth = (!!opts.user) ? `/user:${opts.user} /password:${opts.password}` : '';
		let host = (!!opts.ip) ? opts.ip : 'localhost';
		let command = `wmic ${auth} /node:${host} ${address_list[i].alias} get ${address_list[i].property} /format:value`; 

		exec(command, {timeout: opts.timeout * 1000 || 0}, function(err, stdout, stderr) {
			let isErrorAlias = !!err && err.message.indexOf('Alias not found') != -1;
			let isErrorQuery = !!err && err.message.indexOf('Invalid query') != -1;
			let isErrorTimeout = !!err && err.killed;

			if (i == 0 && err && !(isErrorAlias || isErrorQuery))
				return callback(isErrorTimeout ? new Error('Timeout') : err);

			res[i] = {
				value: isErrorAlias ? 'Alias not found' : isErrorQuery ? 'Invalid query' : parseValue(stdout, address_list[i].property),
				isError: isErrorAlias || isErrorQuery
			};

			getValue(i + 1);				
		})			
	}

	getValue(0);
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}