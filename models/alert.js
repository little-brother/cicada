'use strict'
const db = require('../modules/db');
const events = require('../modules/events');

exports.getList = function(period, callback) {
	let where = period ? `time between ${period[0]} and ${period[1]}` : `is_hidden = 0`;
	db.all(`select a.*, coalesce(d.name, '&#60;&#60;Dropped&#62;&#62;') device_name, is_hidden from alerts a left join devices d on a.device_id = d.id where ${where} order by time asc`, callback);
}

exports.getSummary = function(callback) {
	db.get('select coalesce(sum(case when status == 2 then 1 else 0 end), 0) warning, coalesce(sum(case when status == 3 then 1 else 0 end), 0) critical from alerts where is_hidden = 0', callback);
}

exports.hide = function (id, callback) {
	db.run('update alerts set is_hidden = 1 where id = coalesce(?, id)', id, function (err) {
		if (!err)
			events.emit('alert-hide', id);

		callback(err);
	});
}

exports.add = function(time, status, device_id, reason, callback) {
	db.run('insert into alerts (time, status, device_id, reason, is_hidden) values (?, ?, ?, ?, ?)',
		[time, status, device_id, reason, 0],
		function (err) {
			callback(err, this.lastID);
		}
	)
}