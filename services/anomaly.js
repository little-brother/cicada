'use strict'
const Varbind = require('../models/varbind');
const events = require('../modules/events');
const Client = require('../modules/netclient');

function start(config) {
	let list = config['anomaly-detector'];
	if (!list || !(list instanceof Object)) 
		return events.on('new-connection', (sender) => sender({event: 'no-anomaly-detector'}));

	if (!(list instanceof Array))
		list = [list];
	
	list.forEach(function (opts) {
		let tag_list = opts['tag-list'] instanceof Array && opts['tag-list'] || opts.tags && (opts.tags || '').split(';').map((e) => (e || '').trim()) || [];
		if (tag_list.length == 0)
			return console.error(__filename, 'Tags is required');
	
		let detector = new Client(opts.host, opts.port);
		detector.on('data', function (packet) {
			let id = parseInt(packet[0]);
			let varbind = Varbind.get(id);
			if (!varbind)	 
				return;

			if (!isNaN(packet[1])) {
				let time = parseInt(packet[1]);
				let description = packet[2];

				events.emit('anomaly', {varbind, description}, time); // see alerter.js
				return; 
			}

			if (packet[1] == 'HISTORY') {
				let from = parseInt(packet[2]);
				let to = parseInt(packet[3]);

				if (isNaN(from) || isNaN(to) || from >= to)				
					return console.error(__filename, 'Bad history request: ', JSON.stringify(packet));

				varbind.getParent().getHistory([from, to], id, false, function (err, history) {
					if (err)
						return console.error(__filename, err.message, 'with packet: ' + JSON.stringify(packet));

					let alerts = history.alerts[id] || {};
					let rows = (history.rows || []).map((e, i) => alerts[e[0]] ? [e[0], 'ANOMALY'] : e);

					detector.send([varbind.id, 'HISTORY', rows.map((e) => e.join(';')).join(';')]);
				});

				return;
			}
		});	

		let cache = {}; //idx is device id
		events.on('values-updated', function (device, time) {
			if (!cache[device.id])
				cache[device.id] = device.varbind_list.filter((v) => v.value_type == 'number' && v.tag_list.some((t) => tag_list.indexOf(t) != -1)) || [];
	
			cache[device.id].forEach((varbind) => detector.send([varbind.id, time, varbind.value]));
		});
	});	
}

module.exports = start;