'use strict'
const exec = require('child_process').exec;
const Device = require('../models/device');
const nmap = require('../modules/nmap'); 

function start(config, delay) {
	let params = config['auto-scan'];
	if (!params || !params['on-detect'] || !params.range)
		return;

	if (delay)
		return setTimeout(start, params.period * 1000 || 300000, config);

	nmap.ping(params.range, Device.getIpList().join(','), function(err, result) {
		if (err)
			console.error('Auto-scan: ' + err.message);

		(result || []).forEach(function(r) {
			let ip = r.ip;
			let mac = r.mac;
			let description = r.description;
			try {
				exec(eval(`\`${params['on-detect'].command}\``), params['on-detect'].options || {}, (err, stdout, stderr) => (err) ? console.error(__filename, err.message) : null);
			} catch (err) {
				console.error(__filename, err);
			}
		});

		start(config, true);
	})	
}

module.exports = start;