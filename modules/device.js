'use strict'
const EventEmitter = require('events').EventEmitter;
const async = require('async');
const db = require('./db');
const mixin = require('./mixin');
const protocols = require('./protocols');

let timers = {};

Object.assign(Device, mixin.get('device'), {cache: cacheAll, events: new EventEmitter(), getValue, getIpList, updateLatencies, getHistoryByTag, getTagList});

function cacheAll (callback) {
	async.series([
			(callback) => db.all('select * from devices', callback),
			(callback) => db.all('select * from varbinds', callback),
		], 
		function(err, results) {
			if (err)
				return callback(err);
			results[1].forEach((r) => (new Varbind(r)).cache());
			results[0].forEach((r) => (new Device()).setAttributes(r).cache().updateChildren().updateStatus());
			callback();
		}
	)
}

function getIpList (is_pinged) {
	return Device.getList()
		.map((d) => !is_pinged || is_pinged && d.is_ping ? d.ip : '')
		.map((ip) => (ip + '').trim())
		.filter((ip) => !!ip)
		.filter((e, idx, r) => r.indexOf(e) == idx); // unique
}

function updateLatencies (data, callback) {
	if (!data || !data.length)
		return callback();

	let odata = {};
	data.forEach((row) => odata[row.ip] = row);

	let columns = ['time'];
	let values = [new Date().getTime()];
	Device.getList().forEach(function(d) {
		if (odata[d.ip] == undefined || !d.is_ping)
			return;

		d.alive = !!odata[d.ip].alive;

		columns.push('device' + d.id);
		let latency = odata[d.ip].latency;
		values.push(isNaN(latency) ? 'null' : latency);

		if (!d.is_history) {
			let prev_prev_status = d.prev_status;
			d.prev_status = d.status;
			d.status = odata[d.ip].alive ? 1 : 0;
			Device.events.emit('status-updated', d);
			if (prev_prev_status != undefined && d.prev_status != d.status)
				Device.events.emit('status-changed', d);
		}
	})

	db.run(`insert into history.latencies ("${columns.join('","')}") values (${values.join(',')})`, callback);
}

// Return object: key is tags of devices, values is array of varbind tags
function getTagList () {
	let tags = {};
	let device_list = Device.getList();
	device_list.forEach((d) => d.is_ping && d.tag_list.forEach((tag) => tags[tag] = ['latency']));
	device_list.forEach(function(d) {
		d.tag_list.forEach(function(tag) {
			if (!tags[tag])
				tags[tag] = [];

			d.varbind_list.filter((v) => v.is_history).forEach((v) => tags[tag].push.apply(tags[tag], v.tag_list || []));
		})	
	});

	for (let tag in tags)
		if (tags[tag].length == 0)
			delete tags[tag];	

	tags.All = [];
	for (let tag in tags)
		tags.All.push.apply(tags.All, tags[tag]);

	for (let tag in tags) 
		tags[tag] = tags[tag].filter((t, idx, tags) => tags.indexOf(t) == idx);
	
	return tags;
}

function getHistoryByTag(tag, device_tags, period, callback) {
	let device_list = Device.getList();
	let device_tag_list = (device_tags || '').split(';');

	if (device_tag_list.length && device_tag_list.indexOf('All') == -1) {
		device_list = device_list.filter((d) => device_tag_list.some(function (tag) {
			let re = new RegExp('\\b' + tag + '\\b');
			return re.test(d.tag_list.join(' '))
		}));
	}

	if (!device_list.length)	
		return callback(new Error('Device list is empty')); 

	if (tag == 'latency') {
		db.all(`select "time", ${device_list.map((d) => 'device' + d.id).join(', ')} from history.latencies where time between ? and ? order by "time"`, period, function (err, rows) {
			if (err)
				return callback(err);
	
			let res = {
				columns: ['time'].concat(device_list.map((d) => d.name)),
				rows: rows.map((row) => [row.time].concat(device_list.map((d) => row['device' + d.id])))
			}
			callback(null, res);
		});
		return;
	}

	function getHistory(device, callback) {
		let varbind_list = device.varbind_list.filter((v) => v.tag_list.indexOf(tag) != -1 && v.is_history);
		if (varbind_list.length == 0)
			return callback(null, null);

		db.all(`select "time", ${varbind_list.map((v) => 'varbind' + v.id).join(', ')} from history.device${device.id} where time between ? and ? order by "time"`, period, function (err, rows) {
			if (err)
				return callback(err);
	
			let res = {
				columns: varbind_list.map((v) => device.name + '/' + v.name),
				rows: rows.map((row) => [row.time].concat(varbind_list.map((v) => row['varbind' + v.id])))
			}
			callback(null, res);
		});
	}

	async.mapSeries(device_list, getHistory, function(err, results) {
		if (err)
			return callback(err);

		let columns = ['time'];
		results.forEach((res) => res ? columns.push.apply(columns, res.columns) : null);

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
					times[time][idx[i - 1]] = parseFloat(row[i]) || null;
			})
		})

		let rows = [];
		for (let time in times)
			rows.push(times[time]);
	
		callback(null, {columns, rows});
	})	
}

function Device() {

	this.__type__ = 'device';
	this.setAttributes = setAttributes;
	this.cache = mixin.cache;
	this.delete = deleteIt;
	this.save = save;

	let d = this;
	this.updateStatus = function () {
		d.prev_status = d.status;
		d.status = d.varbind_list.reduce((max, e) => Math.max(max, e.status || 0), 0);
		return d;
	}
	this.varbind_list = [];
	this.polling = polling;
	this.getHistory = getHistory;
	this.status = 0;

	Object.defineProperty(this, 'is_history', {get: () => d.varbind_list.some((v) => v.is_history)});

	this.updateChildren = function() {
		d.varbind_list = mixin.get('varbind').getList().filter((v) => v.device_id == d.id) || [];
		return d;
	}
}

function setAttributes(data) {
	Object.assign(this, data);
	if (this.id) 
		this.id = parseInt(this.id);

	try {
		this.protocols = JSON.parse(data.json_protocols);
	} catch (err) {
		this.json_protocols = '{}';
		this.protocols = {};
	}

	if (!this.json_varbind_list)
		this.json_varbind_list = '[]';

	this.tag_list = !!this.tags ? this.tags.toString().split(';').map((t) => t.trim()).filter((t, idx, tags) => tags.indexOf(t) == idx) : [];
	this.tags = this.tag_list.join(';');

	this.is_ping = parseInt(this.is_ping);

	return this;
}

function getValue(opts, callback) {
	if (!opts.protocol || !protocols[opts.protocol])
		return callback(new Error('Unsupported protocol'));

	if (!opts.address)	
		return callback(new Error('Address is empty'));

	protocols[opts.protocol].getValues(opts.protocol_params, [opts.address], function(err, res) {
		callback(null, (err) ? 'ERR: ' + err.message : applyDivider(res[0].value, opts.divider));
	})
}

function getHistory(period, callback) {
	let device = this;
	
	let columns = ['time'];
	columns.push.apply(columns, device.varbind_list.filter((v) => v.is_history).map((v) => `varbind${v.id}`));

	if (columns.length == 1)
		return callback(null, {columns:['time'], rows: []});
	
	db.all(`select ${columns.join(',')} from history.device${device.id} where time between ? and ? order by "time"`, period, function (err, rows) {
		if (err)	
			return callback(err);

		let res = {
			columns: columns,
			rows: rows.map((row) => columns.map((c) => isNaN(row[c]) ? row[c] : parseFloat(row[c])))
		}
		callback(null, res);
	})
}



function polling (delay) {
	let device = this;
	
	if (timers[device.id]) {
		clearTimeout(timers[device.id]);
		delete timers[device.id];
	}

	if (!device.varbind_list || device.varbind_list.length == 0)
		return;

	if (delay)
		return timers[device.id] = setTimeout(() => device.polling(), delay);

	let values = {};
	async.eachOfSeries(protocols, function(protocol, protocol_name, callback) {
			let opts = device.protocols[protocol_name];
			let varbind_list = device.varbind_list.filter((v) => v.protocol == protocol_name);
			let address_list = varbind_list.map((v) => v.address);

			if (address_list.length == 0 || !opts)
				return callback();

			opts.ip = device.ip;	
			protocol.getValues(opts, address_list, function(err, res) {
				varbind_list.forEach((v, i) => values[v.id] = (err) ? err.message : res[i]);
				callback();
			})
		}, 
		function (err) {	
			device.varbind_list.forEach(function(v, i) {
				if (values[v.id] === undefined)
					return;

				let value = values[v.id].value;
				let isError = values[v.id].isError;

				value = (isError) ? 'ERR: ' + value : applyDivider (value, v.divider);
				let isValueChange = (v.value != value);
				v.value = value;
				v.updateStatus();

				if (isValueChange || v.status != v.prev_status) {
					let sql = 'update varbinds set value = ?, value_type = ? where id = ?'; 
					let params = [v.value, v.value_type, v.id];
					db.run(sql, params, (err) => (err) ? console.log(err, {sql, params}) : null);
				}
			});

			let time = new Date().getTime();
			Device.events.emit('values-changed', device, time);

			if (device.is_history) {
				device.updateStatus();
				Device.events.emit('status-updated', device);
				if (device.prev_status != device.status)
					Device.events.emit('status-changed', device);
			}

			let columns = ['time'];
			let params = [time];
			device.varbind_list.filter((v) => v.is_history).forEach(function(v) {
				columns.push(`varbind${v.id}_status`);			
				columns.push(`varbind${v.id}`);
				params.push(`${v.status}`);
				params.push(`${v.value}`);
				
			});

			if (columns.length > 1) {
				let sql = `insert into history.device${device.id} (${columns.join(',')}) values (${'?, '.repeat(columns.length - 1) + '?'})`;
				db.run(sql, params, (err) => (err) ? console.log(err, {sql, params}) : null);
			}
				
			device.polling(device.period * 1000 || 30000)
		}
	) 
}

function deleteIt (callback) {
	let device = this;
	async.series([
			(callback) => db.run('begin transaction', callback),
			(callback) => db.run('delete from varbinds where device_id = ?', [device.id], callback),
			(callback) => db.run('delete from devices where id = ?', [device.id], callback),
			(callback) => db.run('commit transaction', callback)
		],
		function(err) {
			if (err) 
				return db.run('rollback transaction', (err2) => callback(err));
		
			device.varbind_list.forEach((varbind) => varbind.cache('CLEAR'));
			device.varbind_list = [];
			device.polling();
			device.cache('CLEAR');

			db.run(`drop table history.device${device.id}`, function(err) {
				if (err)
					console.error(err);

				callback();
			})
		}
	)
}

function save (callback) {
	let device = this;
	let isNew = !this.id; 
	let time = new Date().getTime();

	let varbind_list = [];
	let delete_varbind_ids = [];
	
	async.series ([
		function (callback) {
			db.run('begin transaction', callback);
		},

		function (callback) {
			db.upsert(device, ['name', 'description', 'tags', 'ip', 'mac', 'json_protocols', 'is_ping', 'period'], callback);
		},

		function (callback) {
			try {
				varbind_list = JSON.parse(device.json_varbind_list).map(function (v) {
					if (isNew && v.id)
						delete v.id;
					v.device_id = device.id;
					v.updated = time;
					return new Varbind(v);
				});
				delete device.json_varbind_list;
			} catch (err) {
				return callback(err);
			}

			async.eachSeries(
				varbind_list, 
				(varbind, callback) => db.upsert(varbind, ['device_id', 'name', 'protocol', 'json_address', 'divider', 'value_type', 'json_status_conditions', 'tags', 'updated'], callback), 
				callback
			);
		},

		function (callback) { 
			let sql = 'select id from varbinds where device_id = ? and updated <> ?';
			let params = [device.id, time];
			db.all(sql, params, function (err, rows) {
				if (err)
					return callback(err);

				rows.forEach((r) => delete_varbind_ids.push(r.id));
				callback();
			});
		},

		function (callback) { 
			db.run(`delete from varbinds where id in (${delete_varbind_ids.join()})`, callback);
		},

		function (callback) {
			db.run('commit transaction', callback); 
		}
	], function(err) {
		if (err) 
			return db.run('rollback transaction', (err2) => callback(err));

		device = device.cache();

		delete_varbind_ids.forEach((id) => Varbind.get(id).cache('CLEAR'));
		varbind_list.forEach((v) => v.cache());
		device.updateChildren();
		device.prev_status = 0;
		device.status = 0;

		if (isNew)
			db.run(`alter table history.latencies add column device${device.id} real`, (err) => null);

		db.all(`pragma table_info(device${device.id})`, function(err, table_info) {
			let columns = table_info.map((ti) => ti.name);
			if (err)
				return callback(err);

			var history_varbind_list = device.varbind_list.filter((v) => v.is_history);

			if (columns.length == 0) {
				let cols = ['"time" integer primary key'];
				history_varbind_list.forEach(function(varbind) {
					cols.push(`varbind${varbind.id} text`);
					cols.push(`varbind${varbind.id}_status integer`);
				});
				
				let sql = `create table history.device${device.id} (${cols.join(', ')}) without rowid`;
				db.run(sql, (err) => callback(err, device.id)); 
				return;
			}

			var sqls = [];
			history_varbind_list
				.filter((v) => columns.indexOf(`varbind${v.id}`) == -1)
				.forEach(function(varbind) {
					sqls.push(`alter table history.device${device.id} add column varbind${varbind.id} text`);
					sqls.push(`alter table history.device${device.id} add column varbind${varbind.id}_status integer`);
				});
			async.eachSeries(sqls, (sql, callback) => db.run(sql, callback), (err) => callback(err, device.id));
		})

		device.polling(2000);
	});
}



const checkCondition = {
	'greater' : (v, v1) => !isNaN(v) && !isNaN(v1) && parseFloat(v) > parseFloat(v1),
	'equals' : (v, v1) => v == v1,
	'not-equals' : (v, v1) => v != v1,
	'smaller' : (v, v1) => !isNaN(v) && !isNaN(v1) && parseFloat(v) < parseFloat(v1),
	'change' : (v, prev) => prev != undefined && v != undefined && prev != v,
	'regexp' : (v, v1) => (new RegExp(v1)).test(v),
	'anything' : (v, v1) => true,
	'error' : (v) => (v + '').indexOf('ERR') == 0
}


Object.assign(Varbind, mixin.get('varbind'));

function Varbind (data) {
	Object.assign(this, data);
	if(this.id)
		this.id = parseInt(this.id);

	this.__type__ = 'varbind';
	Object.defineProperty(this, 'is_history', {get() {return !!(this.status_conditions.length > 0 || this.value_type == 'number')}});

	this.updateStatus = function () {
		if (!this.status_conditions.length)
			return; 

		this.prev_status = this.status;
		this.status = 0;
		for (let i = 0; i < this.status_conditions.length; i++) {	
			let cond = this.status_conditions[i];
			let val = cond.if != 'change' ? cond.value : this.prev_value;
			if(checkCondition[cond.if] && checkCondition[cond.if](this.value, val)) {
				this.status = cond.status;
				break;
			}
		}
	}

	this.cache = mixin.cache;
	if (!this.value_type)
		this.value_type = 'string';	


	for (let f of ['status_conditions', 'address']) {
		try {
			this[f] = JSON.parse(this['json_' + f]) || {};
		} catch (err) {
			this[f] = {};
			this['json_' + f] = '{}';
		}
	}	
	
	this.tag_list = !!this.tags ? this.tags.toString().split(';').map((t) => t.trim()).filter((t, idx, tags) => tags.indexOf(t) == idx) : [];
	this.tags = this.tag_list.join(';');	
}

// divider is a "number" or "number + char" 
function applyDivider (value, divider) {
	if (!value || isNaN(value) || !divider) 
		return value;

	let div = parseFloat(divider);
	let val = parseFloat(value) / div;
	
	if (div == divider)
		return val;

	let lastChar = divider.slice(-1);
	if (lastChar == 'C')
		return (val - 32) * 5 / 9; // Convert Fahrenheit to Celsius

	if (lastChar == 'F')
		return val * 9 / 5 + 32; // Convert Celsius to Fahrenheit

	if (lastChar == 'R') 
		return +val.toFixed(2); // round to .xx

	return val;
}


module.exports = Device;