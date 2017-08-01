'use strict'
const http = require('http');
const https = require('https');

// opts = {hostname: 127.0.0.1, port: 80, protocol: http}
// address = {path: /get/user/15, check: code}
exports.getValues = function (opts, address_list, callback) {
	let res = [];

	let client = (opts.protocol == 'https') ? https : http;
	let options = {
		hostname: opts.hostname || opts.ip,
		port: parseInt(opts.port) || opts.protocol == 'https' && 443 || 80,
		method: 'GET'
	};	
	if (opts.user)
		options.auth = [opts.user, opts.password].join(':');

	if (options.hostname.indexOf('http://') == 0 || options.hostname.indexOf('https://') == 0)
		return callback(new Error('Don\'t specify the protocol in the hostname.'));

	let timer = process.hrtime();

	function getValue(i) {
		if (i == address_list.length)
			return callback(null, res);

		let address = address_list[i];
		options.path = address.path;
		timer = process.hrtime(timer);
		client.get(options, function (response) {
			let data = '';
			let size = 0;

			response.on('data', function (d) {
				data += d
				size += Buffer.byteLength(d, 'utf-8');
			});

			response.on('end', function() {	
				timer = process.hrtime(timer);
				let val = {
					text: data,
					size: (response.headers || {})['content-length'] || size,
					code: response.statusCode,
					time: timer[1]
				}
				res[i] = {
					value: val[address.check], 
					isError: false
				};

				getValue(i + 1);
			});

			response.on('error', function (err) {
				res[i] = { 
					value: err.message, 
					isError: true
				};

				getValue(i + 1);
			});
		}).on('error', function (err) {
			return callback(err);
		});
	}

	getValue(0);	
}

// ???
exports.doAction = function(opts, action, callback) {
	callback(null);
}