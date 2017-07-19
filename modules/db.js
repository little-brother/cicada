'use strict'
const async = require('async');
const sqlite3 = require('sqlite3');
let db = new sqlite3.Database('./db/main.sqlite');

db.serialize(function() {
	db.run('pragma synchronous = 0');
	db.run('create table if not exists devices (id integer primary key, name text not null, ip text, mac text, tags text, description text, json_protocols text, is_pinged integer, period integer, timeout integer, parent_id integer, force_status_to integer, template text)');
	db.run('create table if not exists varbinds (id integer primary key, device_id integer not null, name text not null, protocol text not null, json_address text, json_status_conditions text, tags text, value text, prev_value text, divider text, value_type text, updated integer)');
	db.run('attach database \"./db/history.sqlite\" as history');
	db.run('attach database \"./db/changes.sqlite\" as changes');
	db.run('create table if not exists history.latencies (\"time\" integer primary key) without rowid');
	db.run('create table if not exists history.alerts (id integer primary key autoincrement not null unique, \"time\" integer, status integer, device_id integer, reason text, is_hidden integer)');
	db.run('create index if not exists history.idx_alerts on alerts (is_hidden)');

	// migration 0.8 => 0.9
	db.run('alter table devices add column template text', (err) => null);
	db.run('alter table devices add column timeout integer', (err) => null);
	db.run('alter table varbinds add column prev_value text', (err) => null);
});

db.checkHistoryTable = function (device, callback) {
	let query_list = [];

	async.series([
		(callback) => db.all(`pragma history.table_info(device${device.id})`, callback),
		(callback) => db.all(`pragma changes.table_info(device${device.id})`, callback)
		], 
		function(err, results) {
			if (err)
				return callback(err);

			let varbind_list, columns; 
			
			varbind_list = device.varbind_list.filter((varbind) => varbind.value_type == 'number');	
	
			if (results[0].length) {
				columns = results[0].map((row) => row.name);
				varbind_list.forEach(function (varbind) {
					if (columns.indexOf('varbind' + varbind.id) == -1)
						query_list.push(`alter table history.device${device.id} add column varbind${varbind.id} real`);
					if (columns.indexOf('varbind' + varbind.id + '_status') == -1)
						query_list.push(`alter table history.device${device.id} add column varbind${varbind.id}_status integer`);
				})
			} else {
				columns = ['"time" integer primary key'];
				varbind_list.forEach(function(varbind) {
					columns.push(`varbind${varbind.id} real`);
					columns.push(`varbind${varbind.id}_status integer`);
				});
				query_list.push(`create table history.device${device.id} (${columns.join(', ')}) without rowid`);
			}

			if (!results[1].length) 
				query_list.push(`create table changes.device${device.id} (varbind_id integer, prev_value text, value text, status integer, start_date integer, end_date integer)`);

			async.eachSeries(query_list, (query, callback) => db.run(query, callback), callback);
		}
	);
}

db.upsert = function (obj, columns, callback) {
	let isNew = !obj.id;
	let table = obj.__type__ + 's';
	let sql = isNew ? 
		`insert into ${table} (` + 
		columns.reduce((list, c) => list.concat(c) , []).join(', ') + 
		') values (' + 
		columns.reduce((list, c) => list.concat('?') , []).join(', ') + ')' :
		`update ${table} set ` + 
		columns.reduce((list, c) => list.concat(c + ' = ?') , []).join(', ') + 
		` where id = ?`;

	let params = columns.map((c) => obj[c]);
	if (!isNew)
		params.push(obj.id);

	db.run(sql, params, function(err) {
		if (err) {
			console.error(__filename, err, sql, params);
			return callback(err);
		}

		if (!isNew && this.changes != 1)
			throw new Error('DB_CORRUPTED');

		if (isNew)				
			obj.id = this.lastID;

		callback(null, obj);
	});	
}

module.exports = db;