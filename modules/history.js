'use strict'

// Get history and its downsample is potencial CPU bound operation, so used new instance of V8 for it.
if (module.parent) {
	const crypto = require('crypto');

	let worker = require('child_process').fork(__filename);
	worker.callbacks = {};

	worker.on('message', function (res) {
		if (!worker.callbacks[res.id])
			return console.error(__filename, 'Unknown message: ', res);
	
		worker.callbacks[res.id](res.err, res.result);
		delete worker.callbacks[res.id];
	});

	worker.do = function(req, callback) {
		req.id = crypto.randomBytes(16).toString('hex');
		worker.callbacks[req.id] = callback;
		worker.send(req);
	}

	return module.exports = {
		get: (device_list, period, downsample, callback) => worker.do({func: 'get', device_list, period, downsample}, callback)
	};
}

const sqlite3 = require('sqlite3');
const async = require('async');
const downsampler = require('downsample-lttb');

let db = new sqlite3.Database('./db/history.sqlite');

process.on('message', function (req) {
	function callback (err, result) {
		result.downsampled = false;
		if (!err && !!req.downsample && req.downsample != 'false')
			result.downsampled = downsampleData(result, parseInt(req.downsample) || 2000);
		
		process.send({err, result, id: req.id});
	}

	if (req.func == 'get')
		return getMany(req.device_list, req.period, callback);

	throw new Error('Bad request: ', req);
});

function getOne(device, period, callback) {
	let varbind_list = device.varbind_list || [];
	if (varbind_list && varbind_list.length == 0 && !device.latency)
		return callback(null, {columns:[], rows: [], alerts: {}});

	let columns = device.latency ? ['time', 'latency'] : ['time'];
	columns.push.apply(columns, varbind_list.map((v) => `varbind${v.id}`));

	let cols = device.latency ? ['time', 'latency'] : ['time'];
	varbind_list.forEach((v) => cols.push(`varbind${v.id}`) && cols.push(`varbind${v.id}_status`));
	
	async.series([
		(callback) => db.all(`select ${cols.join(',')} from device${device.id} where time between ? and ? order by "time"`, period, callback),
		(callback) => db.all(`select time, varbind_id from alerts where device_id = ? and status = 4 and time between ? and ?`, [device.id, period[0], period[1]], callback)
		], function (err, results) {
			if (err)
				return callback(err);

			let history = results[0];
			let anomalies = results[1];

			let alerts = {};
			varbind_list.forEach((v) => alerts[v.id] = {});
			history.forEach(function (row) {
				varbind_list.forEach(function (v) {
					let status = row[`varbind${v.id}_status`];
					if (status == 2 || status == 3)
						alerts[v.id][row.time] = status;
				});
			});

			anomalies
				.filter((a) => !!alerts[a.varbind_id])
				.forEach((a) => alerts[a.varbind_id][a.time] = 4);
		
			let res = {
				ids: varbind_list.map((v) => v.id),
				columns: varbind_list.map((v) => device.name + '/' + v.name), 
				rows: history.map((row) => columns.map((c) => isNaN(row[c]) ? row[c] : parseFloat(row[c]))), 
				alerts
			};

			if (device.latency) {
				res.ids.unshift('latency');
				res.columns.unshift(device.name + '/' + 'latency');
			}

			callback(null, res);			
		}
	);
}

function getMany(device_list, period, callback) { 
	async.map(device_list, (device, callback) => getOne(device, period, callback), function(err, results) {
		if (err)
			return callback(err);

		if (device_list.length == 1) {
			results[0].columns.unshift('time');
			return callback(null, results[0]);
		}

		let ids = [];
		results.forEach((res) => res ? ids.push.apply(ids, res.ids) : null);

		let columns = ['time'];
		results.forEach((res) => res ? columns.push.apply(columns, res.columns) : null);
		
		let alerts = {};
		results.forEach((res) => Object.assign(alerts, res && res.alerts || {}));

		let times = {};
		results.forEach(function (res) {
			if (!res)
				return;

			let idx = res.columns.map((c) => columns.indexOf(c));
			res.rows.forEach(function(row) {
				let time = row[0];
				if (!times[time]) {
					times[time] = new Array(columns.length);	
					times[time][0] = time;
				}

				for (let i = 1; i < row.length; i++) 
					times[time][idx[i - 1]] = parseFloat(row[i]) || row[i];
			})
		})

		let rows = [];
		for (let time in times)
			rows.push(times[time]);

		rows.sort((a, b) => a[0] - b[0]);

		callback(null, {ids, columns, rows, alerts});
	})	
}

function downsampleData(res, threshold) {
	let data = res.rows;
	if (!data || !data.length || data.length < threshold)
		return false;

	try {
		let downsamples = {};
		for (let i = 1; i < res.ids.length + 1; i++) {
			downsamples[i] = {};
			downsampler.processData(data.map((e) => [e[0], e[i]]).filter((e) => +e[1] == e[1]), threshold).forEach((e) => downsamples[i][e[0]] = e[1]);
		}
		
		res.rows = data.map(function (row) {
			let time = row[0];
			let empty = 0;
			for (let i = 1; i < row.length; i++) {
				if (downsamples[i][time] == undefined && (row[i] == +row[i]) && !(res.alerts && res.alerts[res.ids[i - 1]] && res.alerts[res.ids[i - 1]][time] != undefined))
					row[i] = null;
				empty += (row[i] == null || row[i] == undefined) ? 1 : 0;
			}
			return (empty == row.length - 1) ? null : row;
		}).filter((row) => !!row);			
	} catch (err) {
		console.error(__filename, err);
	}
	
	return true;
}