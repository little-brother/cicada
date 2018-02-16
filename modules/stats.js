'use strict'
const fs = require('fs');
const async = require('async');
const db = require('./db');
const Device = require('../models/device');

function size(byte) {
	var i = Math.floor(Math.log(byte) / Math.log(1024));
	return (byte / Math.pow(1024, i)).toFixed(2) * 1 + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

module.exports = function (callback) {
	let device_list = Device.getList();
	let history = device_list.map((d) => `select ${d.id} id, count(1) cnt from history.device${d.id}`).join(' union all ');
	let changes = device_list.map((d) => `select ${d.id} id, count(1) cnt from changes.device${d.id}`).join(' union all ');

	async.series([
		(callback) => db.all(history, callback),
		(callback) => db.all(changes, callback),
		(callback) => db.all('select 1', callback),
		(callback) => db.all('select count(1) cnt from history.alerts', callback),
		(callback) => fs.stat('./db/main.sqlite', callback),
		(callback) => fs.stat('./db/history.sqlite', callback),
		(callback) => fs.stat('./db/changes.sqlite', callback)
	], function (err, results) {
		if (err)
			return callback(err);

		let counts = {};
		device_list.map((d) => counts[d.id] = [0, 0]);
		results[0].forEach((row) => counts[row.id][0] = row.cnt);
		results[1].forEach((row) => counts[row.id][1] = row.cnt);

		let stat = device_list.map((d) => [d.name, d.ip, d.varbind_list.filter((v) => v.value_type == 'number').length, d.varbind_list.length, counts[d.id][0], counts[d.id][1]]);
		let total = [
			'TOTAL', 
			device_list.length, 
			stat.reduce((sum, row) => sum + row[2], 0) + '/' + stat.reduce((sum, row) => sum + row[3], 0),
			stat.reduce((sum, row) => sum + row[4], 0),
			stat.reduce((sum, row) => sum + row[5], 0)
		];
		stat.forEach(function (row) {
			row[2] = row[2] + '/' + row[3];
			row.splice(3, 1);
		});

		let res = [];
		res.push(['name', 'IP', 'varbinds', 'history rows', 'changes rows']);
		res = res.concat(stat);
		res.push([]);
		res.push(total);
		res.push([]);
		res.push(['main: ' + size(results[4].size), 'history: ' + size(results[5].size), 'changes: ' + size(results[6].size), 'alerts: ' + results[3][0].cnt + 'rows']);

		callback(null, 
			'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><link href = "/index.css" rel="stylesheet"/></head><body>' + 
			'<table id = "stats" cellspacing="0" cellpadding="0">' + 
			res.map((row) => '<tr><td>' + row.join('</td><td>') + '</td></tr>').join('') + 
			'</table></body></html>'
		);
	})
}