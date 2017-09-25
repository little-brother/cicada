'use strict'
const Device = require('../models/device');
const nmap = require('../modules/nmap');

function start (config, delay) {
	if (delay)
		return setTimeout(start, config['ping-period'] * 1000 || 300000, config);

	let ips = Device.getIpList(true).join(' ');
	if (!ips) 
		return start(config, true);

	nmap.ping(ips, null, function(err, result) {
		if (err) {
			console.error(__filename, err.message);
			start(config, true);
			return;
		}

		Device.updateLatencies(result, function (err) {
			if (err)
				console.error(__filename, err.message);
			
			start(config, true);
		});
	})
}

module.exports = start;