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
		if (callback)
			worker.callbacks[req.id] = callback;
		worker.send(req);
	}

	return module.exports = {
		get: (device_list, opts, callback) => worker.do({func: 'get', device_list, opts}, callback)
	};
}

const sqlite3 = require('sqlite3');
const async = require('async');
const downsampler = require('downsample-lttb');

let db = new sqlite3.Database('./db/history.sqlite');

process.on('message', function (req) {
	function callback (err, result) {
		if (err)
			console.log(err)
		
		process.send({err, result, id: req.id});
	}

	if (req.func == 'get')
		return getMany(req.device_list, req.opts || {}, callback);

	throw new Error('Bad request: ', req);
});

function dbAll(query, params, callback) {
	db.all(query, params, (err, res) => err && err.code == 'SQLITE_BUSY' ? dbAll(query, params, callback) : callback(err, res));
}

function getOne(device, opts, callback) {
	let period = opts.period || [];
	let downsample = opts.downsample;

	let varbind_list = device.varbind_list || [];
	if (varbind_list && varbind_list.length == 0 && !device.latency)
		return callback(null, {columns:[], rows: [], alerts: {}});

	let columns = device.latency ? ['time', 'latency'] : ['time'];
	columns.push.apply(columns, varbind_list.map((v) => `varbind${v.id}`));

	let cols = device.latency ? ['time', 'latency'] : ['time'];
	varbind_list.forEach((v) => cols.push(`varbind${v.id}`) && cols.push(`varbind${v.id}_status`));
	
	async.series([
			function (callback) {
				dbAll(`select ${cols.join(',')} from device${device.id} where time between ? and ? order by "time"`, period, callback);
			},
			function (callback) {
				if (opts.onlyrows == 'true')
					return callback(null, []);

				dbAll(`select time, varbind_id from alerts where device_id = ? and status = 4 and time between ? and ?`, [device.id, period[0], period[1]], callback)
			}
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
				device_ids: varbind_list.map((v) => device.id),
				ids: varbind_list.map((v) => v.id),
				columns: varbind_list.map((v) => device.name + '/' + v.name), 
				rows: history.map((row) => columns.map((c) => isNaN(row[c]) ? row[c] : parseFloat(row[c]))), 
				alerts,
				period
			};

			if (opts.summary) {
				let summary = {};
				let ids = varbind_list.map((v) => v.id);
				if (device.latency) 
					ids.push(device.name + '/latency');
				ids.forEach((id) => summary[id] = {min: NaN, summa: 0, max: NaN, count: 0});
				history.forEach(function (row, row_no) {
					ids.forEach(function (id) {
						let value = !isNaN(id) ? row['varbind' + id] : row['latency'];
						if (isNaN(value) || value == '') 
							return;

						summary[id].min = isNaN(summary[id].min) || summary[id].min > value ? value : summary[id].min;
						summary[id].max = isNaN(summary[id].max) || summary[id].max < value ? value : summary[id].max;
						summary[id].summa += value;
						summary[id].count++;
					})
				});	

				ids.forEach(function (id) {
					summary[id].avg = summary[id].summa / summary[id].count;
					summary[id].up = 100 * summary[id].count / history.length;
					delete summary[id].summa;
					delete summary[id].count;
				});
				res.summary = summary;
			}

			if (device.latency) {
				res.device_ids.unshift(device.id);
				res.ids.unshift('latency');
				res.columns.unshift(device.name + '/latency');
			}

			res.downsampled = false;
			if (downsample == 'auto' || !isNaN(downsample)) 
				res.downsampled = downsampleData(res, parseInt(downsample) || 2000);
				
			callback(null, res);			
		}
	);
}

function getMany(device_list, opts, callback) {
	let period = opts.period || [];
	let downsample = opts.downsample;
 
	async.map(device_list, (device, callback) => getOne(device, opts, callback), function(err, results) {
		if (err)
			return callback(err);

		if (device_list.length == 1) {
			results[0].columns.unshift('time');
			results[0].period = period;
			return callback(null, results[0]);
		}

		let device_ids = [];
		results.forEach((res) => res ? device_ids.push.apply(device_ids, res.device_ids) : null);

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
		let downsampled = results.some((res) => res.downsampled);

		let result = {device_ids, ids, columns, rows, alerts, period, downsampled}
		if (opts.summary) {
			result.summary = {};
			results.forEach((res) => Object.assign(result.summary, res && res.summary || {}));
		}

		callback(null, result);
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