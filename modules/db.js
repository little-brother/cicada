'use strict'
const async = require('async');
const sqlite3 = require('sqlite3');
const config = require('../config.json').db || {}; // {synchronous: 0, journal_mode: 'DELETE'};

let db = new sqlite3.Database('./db/main.sqlite');

db.serialize(function() {
	db.serialize(function() {	
		for (let prop in config)
			db.run(`pragma ${prop} = ${config[prop]}`, (err) => (err) ? console.error(__filename, err, prop, config[prop]) : null);
	});
	
	db.run('create table if not exists devices (id integer primary key, name text not null, ip text, mac text, tags text, description text, json_protocols text, is_pinged integer, period integer, timeout integer, parent_id integer, force_status_to integer)');
	db.run('create table if not exists varbinds (id integer primary key, device_id integer not null, name text not null, protocol text not null, json_address text, condition_id number, tags text, value text, prev_value text, divider text, value_type text, status integer, check_id integer, updated integer)');
	db.run('create table if not exists conditions (id integer primary key, name text, gap real, json_condition_list text)');
	db.run('create table if not exists diagrams (id integer primary key, name text not null, json_element_list text not null)');
	db.run('create table if not exists checks (id integer primary key, name text, include_tags text, exclude_tags text, protocol text not null, json_protocol_params text, json_address text, divider text, value_type text, condition_id number, tags text, updated integer)');
	db.run('create unique index if not exists idx_check on varbinds (device_id, check_id)', (err) => null);
	db.run('attach database \"./db/history.sqlite\" as history');
	db.run('attach database \"./db/changes.sqlite\" as changes');
	db.run('create table if not exists history.alerts (id integer primary key autoincrement not null unique, \"time\" integer, status integer, path text, device_id integer, varbind_id integer, description text, is_hidden integer)');
	db.run('create index if not exists history.idx_alerts on alerts (is_hidden)');

	// migration 0.8 => 0.9
	db.run('alter table devices add column timeout integer', (err) => null);
	db.run('alter table varbinds add column prev_value text', (err) => null);

	// migration 0.10 => 0.11
	db.run('alter table varbinds add column status integer', (err) => null);

	// migration 0.11 => 0.12
	db.run('alter table varbinds add column check_id integer', (err) => null);

	// migration 0.14 => 0.15
	db.run('alter table history.alerts add column path text', (err) => null);
	db.run('alter table history.alerts add column varbind_id integer', (err) => null);
	db.run('alter table history.alerts add column description text', (err) => null);
	db.run('drop table history.latencies', (err) => null);

	// migration 0.15 => 0.16
	db.run('alter table varbinds add column condition_id integer', (err) => null);
	db.run('alter table checks add column condition_id integer', (err) => null);
});

['all', 'get', 'run'].forEach(function (fname) {
	let _f = db[fname];
	db[fname] = function (a, b, c) {
		let ctx = this;
		let args = arguments;
	
		for (let i in args) {
			let arg = args[i];
			if (typeof(arg) =='function') {
				args[i] = function () {
					let err = arguments[0];
					if (err && err instanceof Error) {
						err.sql = args[0];
						if (typeof(args[1]) != 'function')
							err.params = args[1];
					} 
		
					return err && err instanceof Error && err.code == 'SQLITE_BUSY' ? _f.apply(ctx, args) : arg.apply(this, arguments);
				}
				break;
			}
		}
		_f.apply(ctx, args);  
	}	
});

let buffer  = [{query: 'begin transaction'}];
db.push = function (query, params) {
	buffer.push({query, params});
}

db.flushBuffer = function () {
	let list = buffer;
	list.push({query: 'commit transaction'});
	buffer = [{query: 'begin transaction'}];

	function run(i) {
		if (i == list.length)
			return setTimeout(db.flushBuffer, parseInt(config.flush) * 1000|| 30000);

		db.run(list[i].query, list[i].params, function (err) {
			if (err)
				console.error(err);

			run(i + 1);
		})
	}
	run(0);	
}

db.flushBuffer();

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
			
			varbind_list = device.varbind_list.filter((varbind) => varbind.is_history);	
	
			if (results[0].length) {
				columns = results[0].map((row) => row.name);

				if (columns.indexOf('latency') == -1)
					query_list.push(`alter table history.device${device.id} add column latency real`);

				varbind_list.forEach(function (varbind) {
					if (columns.indexOf('varbind' + varbind.id) == -1)
						query_list.push(`alter table history.device${device.id} add column varbind${varbind.id} real`);
					if (columns.indexOf('varbind' + varbind.id + '_status') == -1)
						query_list.push(`alter table history.device${device.id} add column varbind${varbind.id}_status integer`);
				})
			} else {
				columns = ['"time" integer primary key', 'latency real'];
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
			console.log(isNew, this.changes, sql, params)

		if (!isNew && this.changes != 1) 
			throw new Error('DB_CORRUPTED');

		if (isNew)				
			obj.id = this.lastID;

		callback(null, obj);
	});	
}

module.exports = db;