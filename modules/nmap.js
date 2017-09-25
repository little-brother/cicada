'use strict'
const exec = require('child_process').exec;
const spawn = require('child_process').spawn;

exports.ping = function (range, exclude, callback) {
	let stdout = '';
	let stderr = '';

	if (!range)	
		callback(new Error('Range is empty.'));

	let r = (range || '').split('--exclude');
	let params = ['-sn'].concat(r[0].split(' '));
	if (!!r[1] || !!exclude) {
		params.push('--exclude');
		params.push([r[1], exclude].filter((e) => !!e).join(','));
	}

	let proc = spawn('nmap', params);
	proc.stdout.on('data', (data) => stdout += data + '');
	proc.stderr.on('data', (data) => stderr += data + '');
	proc.on('close', (code) => {
		if (code)		
			return callback(new Error(code + ' ' + stderr + ' with ' + params.join(' ')));
		
		let result = stdout
			.replace(/(?:\r\n|\r|\n)/g, ' ')
			.split('Nmap scan').slice(1)
			.map(function(row) {
				return {
					ip: (row.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/) || [])[0],
					for: (row.match(/ report for ([\S]*) \(/) || [])[1],
					mac: (row.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/) || [])[0],
					description: (row.match(/\(([^)]*)\)(\s|)$/) || []) [1],
					latency: parseFloat((row.match(/Host is up \(([\d,\.]*)s latency\)/) || [])[1]),
					alive: row.indexOf('Host is up') != -1
				}
			}) || [];

		callback(null, result);	
	});
	return proc;
}

exports.route = function (ip, callback) {
	let stderr = '';
	let stdout = '';

	let proc = spawn('nmap', ['-sn', '--traceroute', ip]);
	proc.stdout.on('data', (data) => stdout += data + '');
	proc.stderr.on('data', (data) => stderr += data + '');
	proc.on('close', (code) => {
		if (code)		
			return callback(new Error(code + ' ' + stderr + ' for ' + ip));

		let res = stdout.split('\n')
			.map((row) => row.trim())
			.filter((row) => /^\d/.test(row))
			.map((row) => (row.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/) || [])[0])
			.filter((e) => !!e && e != ip);

		callback(null, res)
	});
}

exec('nmap /?', (err) => (err) ? console.error(__filename, 'nmap not found') : null);