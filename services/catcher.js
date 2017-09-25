'use strict'
const spawn = require('child_process').spawn;
const Device = require('../models/device');

function start(config) {
	for (let catcher_name in config.catchers) {
		let opts = config.catchers[catcher_name];
		let catcher = spawn(opts.command, opts.args || [], opts.options || {});
	
		var pattern;
		try {
			pattern = new RegExp(opts.pattern);	
		} catch (err) {
			console.error(__filename, catcher_name, err);
			continue;
		}
		
		function onData(data) {
			let ip = pattern.exec(data);
			if (ip)
				Device.getList().filter((d) => d.ip == ip).forEach((d) => d.polling());
		} 
		
		catcher.stdout.on('data', onData);
		catcher.stderr.on('data', onData);
		catcher.on('close', (code) => console.error(__filename, `Catcher "${catcher_name}" crashed with code ${code}`));
	}
}

module.exports = start;