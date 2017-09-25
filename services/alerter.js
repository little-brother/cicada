'use strict'
const Alert = require('../models/alert');
const events = require('../modules/events');
const nmap = require('../modules/nmap');

let alert_summary  = {warning: 0, critical: 0};

function updateSummary(callback) {
	Alert.getSummary(function (err, res) {
		if (err)
			return console.error(__filename, err);

		alert_summary = res;
		if (callback)
			callback();
	});
}

function sendSummary() {
	let packet = Object.assign({event: 'alert-summary'}, alert_summary);
	events.emit('broadcast', packet);	
}

let cache = {};
function isAlerterActive (period, time) {
	if (!period)	
		return true;

	let t = {day: time.getDay(), time: 60 * time.getHours() + time.getMinutes()};
	let check = (p, e) => p.day1 <= e.day && e.day <= p.day2 && p.time1 <= e.time && e.time < p.time2;

	if (!cache[period])
		cache[period] = period.split(';').map(function (p) {
			let r = p.match(/(\d)-(\d),(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
			if (!r)	{
				console.error(__filename, 'Invalid time pattern: ' + period);
				return null;
			} 

			r = r.map((e) => parseInt(e));
			return {day1: r[1], day2: r[2], time1: r[3] * 60 + r[4], time2: r[5] * 60 + r[6]};			
		}).filter((p) => !!p);

	return cache[period].some((p) => check(p, t));
}

events.on('alert-hide', () => updateSummary(sendSummary));
events.on('new-connection', sendSummary);
events.on('status-changed', function(device, time, reason) {
	if (device.status != 2 && device.status != 3)
		return;

	alert_summary[device.status == 2 ? 'warning' : 'critical']++;

	sendSummary();

	
	Alert.add(time, device.status, device.id, reason, function (err, id) {
		if (err) 
			return console.error(__filename, err.message)

		let packet = {event: 'alert-info', id, time, reason, status: device.status, device_name: device.name, device_id: device.id};
		events.emit('broadcast', packet, (client) => !client.device_id);
	});
});

function start (config) {
	updateSummary();

	let device_alerters = {};
	events.on('status-changed', function(device, time, reason) {
		// Find appropriate alerters for device by tags
		// If device don't have any alerter tag then use default alerter
		let hash = device.id + '-' + device.tags;
		if (!device_alerters[hash]) {
			let alerter_names = Object.keys(config.alerters || {}).map((e) => '$' + e);
			let tags = device.tag_list.filter((t) => alerter_names.indexOf(t) != -1);
	
			for (let alerter_name in config.alerters) {
				let opts = config.alerters[alerter_name];
				
				if (opts.tags && opts.tags.length && opts.tags.some((t) => d.tag_list.indexOf(t) != -1))
					tags.push(alerter_name);
			}
	
			if (tags.length == 0)
				tags.push('default');
	
			device_alerters[hash] = tags;
		}
	
		function run () {
			device_alerters[hash].forEach(function (alerter_name) {
				let opts = config.alerters && config.alerters[alerter_name];
	
				if (!opts || !opts.event || !opts.command || !isAlerterActive(opts.active, time))
					return;
	
				if (opts.event == 'on-change' ||
					opts.event == 'on-normal' && device.status == 1 ||
					opts.event == 'on-warning' && device.status == 2 ||
					opts.event == 'on-critical' && device.status == 3) {
					try {
						exec(eval(`\`${opts.command}\``), opts.options || {}, (err, stdout, stderr) => (err) ? console.error(__filename, alerter_name, err) : null);
					} catch (err) {
						console.error(__filename, alerter_name, err);
					}				
				}
			})
		}
	
		// "Don't trigger alarm if parent is down" support
		if (!device.parent_id)
			return run();
	
		let parent = device.getParent();
		if (parent && parent.ip)
			return nmap.ping(parent.ip, null, (err, res) => (err || res && res[0] && res[0].alive) ? run() : null);
	
		device.updateParent(function(err, parent) {
			if (err) 
				return console.error(__filename, err) || run();
	
			if (parent)
				return nmap.ping(parent.ip, null, (err, res) => (err || res && res[0] && res[0].alive) ? run() : null);
		});
	})
}

module.exports = start;