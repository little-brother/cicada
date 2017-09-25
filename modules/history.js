'use strict'

// Get history and its downsample is potencial CPU bound operation, so used new instance of V8 for it.
if (module.parent) {
	let worker = require('child_process').fork(__filename);
	worker.callbacks = {};

	worker.on('message', function (res) {
		if (!worker.callbacks[res.id])
			return console.error('Unknown message: ', res);
	
		worker.callbacks[res.id](res.err, res.result);
		delete worker.callbacks[res.id];
	});

	worker.do = function(req, callback) {
		req.id = new Date().getTime();
		worker.callbacks[req.id] = callback;
		worker.send(req);
	}

	return module.exports = {
		get: (device_list, period, downsample, callback) => worker.do({func: 'get', device_list, period, downsample}, callback),
		getLatency: (device_list, period, downsample, callback) => worker.do({func: 'getLatency', device_list, period, downsample}, callback)
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

	if (req.func == 'getLatency')
		return getLatency(req.device_list, req.period, callback);

	throw new Error('Bad request: ', req);
});

function getOne(device, period, callback) {
	let varbind_list = device.varbind_list;
	if (varbind_list.length == 0)
		return callback(null, {columns:[], rows: [], alerts: {}});

	let columns = ['time'];
	columns.push.apply(columns, varbind_list.map((v) => `varbind${v.id}`));

	let cols = ['time'];
	varbind_list.forEach((v) => cols.push(`varbind${v.id}`) && cols.push(`varbind${v.id}_status`));
	
	db.all(`select ${cols.join(',')} from device${device.id} where time between ? and ? order by "time"`, period, function (err, rows) {
		if (err)	
			return callback(err);

		let alerts = {};
		varbind_list.forEach((v) => alerts[v.id] = {});
		rows.forEach(function (row) {
			varbind_list.forEach(function (v) {
				let status = row[`varbind${v.id}_status`];
				if (status == 2 || status == 3)
					alerts[v.id][row.time] = status;
			});
		});

		let res = {
			ids: varbind_list.map((v) => v.id),
			columns: varbind_list.map((v) => device.name + '/' + v.name), 
			rows: rows.map((row) => columns.map((c) => isNaN(row[c]) ? row[c] : parseFloat(row[c]))), 
			alerts
		};
		callback(null, res);
	});
}

function getMany(device_list, period, callback) { 
	async.map(device_list, (device, callback) => getOne(device, period, callback), function(err, results) {
		if (err)
			return callback(err);

		if (device_list.length == 1) {
			res.columns.unshift('time');
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

function getLatency(device_list, period, callback) {
	db.all(`select "time", ${device_list.map((d) => 'device' + d.id).join(', ')} from latencies where time between ? and ? order by "time"`, period, function (err, rows) {
		if (err)
			return callback(err);

		let res = {
			ids: device_list.map((d) => d.id),
			columns: ['time'].concat(device_list.map((d) => d.name)),
			rows: rows.map((row) => [row.time].concat(device_list.map((d) => row['device' + d.id]))),
			alerts: {}
		}
		callback(null, res);
	});
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