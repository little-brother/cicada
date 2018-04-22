'use strict'
const async = require('async');
const db = require('../modules/db');

const columns = ['name', 'include_tags', 'exclude_tags', 'protocol', 'json_protocol_params', 'json_address', 'divider', 'value_type', 'condition_id', 'tags', 'updated'];

function parse (json, def) {
	def = def || {};
		
	if (!json)
		return def;

	try {
		return JSON.parse(json)	
	} catch (err) {
		console.error(__filename, err.message, json);
		return def;
	}
}

exports.update = function (callback) {
	async.mapSeries([		
		'select * from checks',
		'select id, json_protocols, tags from devices',
		'select id, device_id, check_id from varbinds where check_id is not null'
		], 
		(query, callback) => db.all(query, callback),
		function (err, results) {
			if (err)
				return callback(err);

			let split = (str) => (str || '').split(';');
			let check_list = results[0].map((row) => Object.assign(row, {include_tag_list: split(row.include_tags), exclude_tag_list: split(row.exclude_tags)}));
			let device_list = results[1].map((row) => Object.assign(row, {tag_list: split(row.tags), protocols: {}}));
			let varbind_list = results[2];

			device_list.forEach((device) => device.protocols = parse(device.json_protocols));

			let query_list = [['begin transaction']];
			let isIntersect = (arr, arr2) => arr.some((e) => arr2.indexOf(e) != -1);
			let unchecked_device_list = [];

			device_list.map(function(device) {
				let device_check_list = check_list.filter((check) => isIntersect(device.tag_list, check.include_tag_list) && !isIntersect(device.tag_list, check.exclude_tag_list));
		
				if (device_check_list.length) {
					query_list.push([`delete from varbinds where check_id is not null and device_id = ${device.id} and check_id not in (${device_check_list.map((c) => c.id).join(', ')})`]);
				} else {
					unchecked_device_list.push(device.id);
				}
		
				let existing = varbind_list.filter((varbind) => varbind.device_id == device.id).map((varbind) => varbind.check_id);
				device_check_list
					.filter((check) => existing.indexOf(check.id) == -1)
					.forEach(function (check) {
						if (!device.protocols[check.protocol]) {
							device.protocols[check.protocol] = parse(check.json_protocol_params);
							query_list.push([
								`update devices set json_protocols = ? where id = ?`, 
								[JSON.stringify(device.protocols), device.id]
							]);
						}
								
						let query = `insert into varbinds (device_id, name, protocol, check_id) values (?, ?, ?, ?)`;

						query_list.push([query, [device.id, 'group-check', 'group-protocol', check.id]]);
					})
			});

			if (unchecked_device_list.length)
				query_list.push([`delete from varbinds where check_id is not null and device_id in (${unchecked_device_list.join(', ')})`]);

			query_list.push(['commit transaction']);


			async.eachSeries(query_list, (query, callback) => db.run(query[0], query[1], callback), callback);
		}
	);
}

exports.getList = function(callback) {
	db.all(`select * from checks order by name`, function(err, rows) {
		if (err)
			return callback(err);

		rows.forEach(function (row) {
			['protocol_params', 'address'].forEach(function (prop) {
				row[prop] = parse(row['json_' + prop]);
				delete row['json_' + prop];
			})
		});

		callback(err, rows);
	});
}


exports.saveList = function(check_list, callback) {
	let time = new Date().getTime();
	check_list = parse(check_list, []);

	check_list.forEach(function (check) {
		check.__type__ = 'check';
		check.updated = time;
	});

	async.series([
		(callback) => db.run('begin transaction', callback),
		(callback) => async.eachSeries(check_list, (check, callback) => db.upsert(check, columns, callback), callback),
		(callback) => db.run('delete from checks where updated <> ?', [time], callback),
		(callback) => db.run('commit transaction', callback)
		], (err, results) => callback(err, null)
	);
}