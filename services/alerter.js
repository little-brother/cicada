'use strict'
const exec = require('child_process').exec;
const Alert = require('../models/alert');
const events = require('../modules/events');
const network = require('../modules/network');
const helpers = require('../public/helpers.js');

let alert_summary  = {anomaly: 0, warning: 0, critical: 0};
let alerter_list;

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

function saveAlert(status, device, varbind, value, description, time) {
	let alert = {
		path: varbind ? device.name + '/' + varbind.name : device.name,
		device_id: device.id,
		varbind_id: varbind && varbind.id,
		description,
		status
	}

	Alert.save(alert, time, function (err, alert) {
		if (err) 
			return console.error(__filename, err.message);

		let packet = Object.assign({event: 'alert-info', value_type: varbind && varbind.value_type, time}, alert);
		events.emit('broadcast', packet);//, (client) => alert.varbind.device_id == client.device_id || client.device_id == -1);
	});
}

events.on('alert-hide', () => updateSummary(sendSummary));
events.on('alert-delete', () => updateSummary(sendSummary));

events.on('new-connection', sendSummary);
events.on('status-changed', function(device, time, reason) {
	if (device.status != 2 && device.status != 3)
		return;

	alert_summary[device.status == 2 ? 'warning' : 'critical']++;

	sendSummary();

	if (reason) {
		saveAlert(device.status, device, null, null, reason, time);
	} else {
		let varbind_list = device.varbind_list.filter((v) => v.is_status && v.status == device.status);
		varbind_list.forEach((varbind) => saveAlert(device.status, device, varbind, varbind.value, 'Value: ' + helpers.cast(varbind.value_type, varbind.value), time));
		reason = varbind_list.map((varbind) => varbind.name + ': ' + helpers.cast(varbind.value_type, varbind.value)).join(', ');
	}

	let run = () => runAlerters(device, time, reason, function (alerter) {
		return alerter.event == 'on-change' ||
			alerter.event == 'on-normal' && device.status == 1 ||
			alerter.event == 'on-warning' && device.status == 2 ||
			alerter.event == 'on-critical' && device.status == 3
	});

	// "Don't trigger alarm if parent is down" support
	if (!device.parent_id)
		return run();

	let parent = device.getParent();
	if (parent && parent.ip)
		return network.ping(parent.ip, (err, latency) => (err || !isNaN(latency)) ? run() : null);

	device.updateParent(function(err, parent) {
		if (err) 
			console.error(__filename, err.message);

		if (!parent)
			return run();

		network.ping(parent.ip, (err, latency) => (err || !isNaN(latency)) ? run() : null);
	});
});

events.on('anomaly', function (anomaly, time) {
	if (Alert.hasNeighbor(time, anomaly.varbind.id))
		return;

	alert_summary.anomaly++;

	sendSummary();

	let varbind = anomaly.varbind;
	let device = varbind.getParent();	
	saveAlert(4, device, varbind, anomaly.value, anomaly.description, time);

	runAlerters(device, time, anomaly.description, (alerter) => alerter.event == 'on-anomaly');
});

let alerter_lists = {}; // cached alerter for device; index is a "device id + device tags"
function runAlerters(device, time, reason, filter) {
	let hash = device.id + '-' + device.tags;
	if (!alerter_lists[hash]) 
		alerter_lists[hash] = alerter_list.filter((alerter) => alerter.tag_list.length == 0 || alerter.tag_list.some((t) => device.tag_list.indexOf(t) != -1));

	alerter_lists[hash]
		.filter(filter)
		.forEach(function (alerter) {
			if (!isAlerterActive(alerter.active, time))
				return;
	
			try {
				exec(eval(`\`${alerter.command}\``), alerter.options, (err, stdout, stderr) => (err) ? console.error(__filename, err, JSON.stringify(alerter)) : null);
			} catch (err) {
				console.error(__filename, err, JSON.stringify(alerter));
			}				
		});
}

function start (config) {
	updateSummary();

	alerter_list = config['alerter-list'] || [];
	alerter_list.forEach(function (alerter) {
		alerter.tag_list = alerter['tag-list'] || alerter.tags && alerter.tags.split(';') || [];
		alerter.options = alerter.options || {};
	})
	
	alerter_list = alerter_list.filter((alerter) => !!alerter.event && !!alerter.command);
}

module.exports = start;