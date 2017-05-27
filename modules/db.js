'use strict'
const sqlite3 = require('sqlite3');
let db = new sqlite3.Database('./db/main.sqlite');

db.serialize(function() {
	db.run('pragma synchronous = 0');
	db.run('create table if not exists devices (id integer primary key, name text not null, ip text, mac text, tags text, description text, json_protocols text, is_pinged integer, period integer, parent_id integer, force_status_to integer)');
	db.run('create table if not exists varbinds (id integer primary key, device_id integer not null, name text not null, protocol text not null, json_address text, json_status_conditions text, tags text, value text, divider text, value_type text, updated integer)');
	db.run('attach database \"./db/history.sqlite\" as history');
	db.run('create table if not exists history.latencies (\"time\" integer primary key) without rowid');
});

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