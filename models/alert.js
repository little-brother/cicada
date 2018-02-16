'use strict'
const db = require('../modules/db');
const events = require('../modules/events');

let times = {}; // idx - varbind_id

function round5  (time) {
	const min5 = 1000 * 60 * 5;
	return Math.round(time / min5) * min5; 
}

function cacheTime(time, varbind_id) {
	if (isNaN(varbind_id) || isNaN(time))
		return;
		
	if (!times[varbind_id])	
		times[varbind_id] = {};

	times[varbind_id][round5(time)] = true;
}

exports.hasNeighbor = function (time, varbind_id) {
	return !!(times[varbind_id] && times[varbind_id][round5(time)]);
}

exports.cacheAnomalies = function (callback) {
	db.all('select time, varbind_id from history.alerts where status = 4', function (err, rows) {
		if (err)
			return callback(err);

		rows.forEach((r) => cacheTime(r.time, r.varbind_id));
		callback();
	});
}

exports.getList = function(period, callback) {
	let where = period ? `time between ${period[0]} and ${period[1]}` : `is_hidden = 0`;
	db.all(`select a.*, v.value_type from alerts a left join varbinds v on a.varbind_id = v.id where ${where} order by time asc`, callback);
}

exports.getSummary = function(callback) {
	db.get(`select 
		coalesce(sum(case when status == 2 then 1 else 0 end), 0) warning, 
		coalesce(sum(case when status == 3 then 1 else 0 end), 0) critical, 
		coalesce(sum(case when status == 4 then 1 else 0 end), 0) anomaly
		from alerts where is_hidden = 0`, callback);
}

exports.delete = function (id, callback) {
	db.run(`delete from history.alerts where id = ?`, parseInt(id), function (err) {
		if (!err)
			events.emit('alert-delete', id);

		callback(err, id);
	});
}

exports.hide = function (ids, callback) {
	let id_list =  (ids + '').split(';').map((e) => parseInt(e)).filter((e) => !isNaN(e));
	db.run(`update history.alerts set is_hidden = 1 where id in (${id_list.join(', ')})`, function (err) {
		if (!err)
			id_list.forEach((id) => events.emit('alert-hide', id));

		callback(err, id_list);
	});
}

exports.save = function(alert, time, callback) {
	cacheTime(time, alert.varbind_id);

	db.run('insert into history.alerts (time, status, path, device_id, varbind_id, description, is_hidden) values (?, ?, ?, ?, ?, ?, ?)',
		[time, alert.status, alert.path, alert.device_id, alert.varbind_id, alert.description, 0],
		function (err) {
			alert.id = !err && this.lastID;
			callback && callback(err, alert);
		}
	)
}