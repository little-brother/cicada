'use strict'
const exec = require('child_process').exec;

// opts = {user: Home, password: mypassword, ip: localhost, timeout: 3}
// address = {alias: cpu, property: caption}
exports.getValues = function(opts, address_list, callback) {
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

	function parseError(error) {
		return error.replace(/^([\s\S]*)ERROR:/g, '').replace(/^([\s\S]*)Description = /g, '').trim();
	}

	function getValue(i) {
		if (i == address_list.length) 
			return callback(null, res);

		let auth = (!!opts.user) ? `/user:${opts.user} /password:${opts.password}` : '';
		let host = (!!opts.ip) ? opts.ip : 'localhost';
		let command = `wmic ${auth} /node:${host} ${address_list[i].alias} get ${address_list[i].property} /format:value`; 

		exec(command, {timeout: opts.timeout * 1000 || 0}, function(err, stdout, stderr) {
			res[i] = {
				value: (err) ?  err.killed && 'Timeout' || parseError(stderr) : parseValue(stdout, address_list[i].property),
				isError: !!(err)
			};

			getValue(i + 1);				
		})			
	}

	getValue(0);
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}