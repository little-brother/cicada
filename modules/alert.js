'use strict'
const db = require('./db');
const mixin = require('./mixin');

exports.getList = function(callback) {
	db.all(`select a.*, d.name device_name from alerts a inner join devices d on a.device_id = d.id where is_hidden = 0 order by time asc`, callback);
}

exports.getSummary = function(callback) {
	db.get('select coalesce(sum(case when status == 2 then 1 else 0 end), 0) warning, coalesce(sum(case when status == 3 then 1 else 0 end), 0) critical from alerts where is_hidden = 0', callback);
}

exports.hide = function (id, callback) {
	db.run('update alerts set is_hidden = 1 where id = ?', id, callback);
}

exports.add = function(time, status, device_id, reason, callback) {
	db.run('insert into alerts (time, status, device_id, reason, is_hidden) values (?, ?, ?, ?, ?)',
		[time, status, device_id, reason, 0],
		function (err) {
			callback(err, this.lastID);
		}
	)
}