'use strict'
const fs = require('fs');
const async = require('async');

const db = require('../modules/db');
const mixin = require('./mixin');
const protocols = fs.readdirSync('./protocols').reduce((r, f) => {r[f] = require('../protocols/' + f); return r;}, {});
const network = require('../modules/network');
const history = require('../modules/history');
const events = require('../modules/events');

const Varbind = require('./varbind');
const Condition = require('./condition');

let timers = {};

Object.assign(Device, mixin.get('device'), {cache: cacheAll, getValue, discovery, getIpList, getHistoryByTag, getTags, getTagLists});

function cacheAll (callback) {
	async.series([
			(callback) => db.all('select * from devices', callback),
			(callback) => db.all('select * from varbinds', callback),
			(callback) => db.all('select * from conditions', callback),
			(callback) => db.all('select * from checks', callback)
		], 
		function(err, results) {
			if (err)
				return callback(err);

			let device_list = results[0];
			let varbind_list = results[1];
			let condition_list = results[2];
			let check_list = results[3];

			// Varbinds with check_id don't have any props
			// Set them by appropriate check
			let checks = {};
			check_list.forEach((r) => checks[r.id] = r);

			let columns = varbind_list.length ? Object.keys(varbind_list[0]).filter((c) => c != 'id' && c != 'updated') : [];
			varbind_list.filter((r) => !!r.check_id && checks[r.check_id]).forEach(function(r) {
				let check = checks[r.check_id];
				columns.filter((c) => check[c] != undefined).forEach((c) => r[c] = check[c]);
			});

			varbind_list.forEach((r) => (new Varbind(r)).cache());
			device_list.forEach((r) => (new Device()).setAttributes(r).cache().updateVarbindList().updateStatus());
			condition_list.forEach((r) => (new Condition(r)).setAttributes(r).cache())

			async.eachSeries(Device.getList(), db.checkHistoryTable, callback);
		}
	)
}

function getIpList (is_pinged) {
	return Device.getList()
		.map((d) => !is_pinged || is_pinged && d.is_pinged ? d.ip : '')
		.map((ip) => (ip + '').trim())
		.filter((ip) => !!ip)
		.filter((e, idx, r) => r.indexOf(e) == idx); // unique
}

// Return object: keys is device tag, values is array of varbind tags
function getTags () {
	let tags = {All: []};
	let device_list = Device.getList();
	device_list.forEach((d) => d.is_pinged && d.tag_list.forEach((tag) => tags[tag] = ['latency']));

	let push = (target, list) => target.push.apply(target, list.filter((tag) => tag[0] != '$') || []);
	device_list.forEach(function(d) {
		d.tag_list.filter((tag) => tag[0] != '$').forEach(function(tag) {
			if (!tags[tag])
				tags[tag] = [];

			d.varbind_list.filter((v) => v.is_history && !v.is_temporary).forEach((v) => push(tags[tag], v.tag_list));
		})

		if (d.tag_list.length == 0)
			d.varbind_list.filter((v) => v.is_history && !v.is_temporary).forEach((v) => push(tags.All, v.tag_list));
	});

	for (let tag in tags)
		if (/* tags[tag].length == 0 &&  tag != 'All' || */tag[0] == '$')
			delete tags[tag];	

	for (let tag in tags)
		tags.All.push.apply(tags.All, tags[tag]);

	for (let tag in tags) 
		tags[tag] = tags[tag].filter((t, idx, tags) => tags.indexOf(t) == idx);
	
	return tags;
}

// Return all device and varbind tag lists
function getTagLists() {
	let device_tag_list = [];
	let varbind_tag_list = [];

	Device.getList().forEach((d) => device_tag_list.push.apply(device_tag_list, d.tag_list || []));
	Varbind.getList().forEach((v) => varbind_tag_list.push.apply(varbind_tag_list, v.tag_list || []));

	return {
		device: device_tag_list.filter((e, idx, r) => r.indexOf(e) == idx),
		varbind:  varbind_tag_list.filter((e, idx, r) => r.indexOf(e) == idx)
	}
}

function getHistoryByTag(tag, device_tags, period, downsample, callback) {
	let device_list = Device.getList();
	let device_tag_list = (device_tags || '').split(';');

	if (device_tag_list.length && device_tag_list.indexOf('All') == -1) {
		device_list = device_list.filter((d) => device_tag_list.some(function (tag) {
			let re = new RegExp('\\b' + tag + '\\b');
			return re.test(d.tag_list.join(' '));
		}));
	}

	if (!device_list.length)	
		return callback(new Error('Device list is empty')); 

	if (tag == 'latency')
		return history.get(device_list.filter((d) => d.is_pinged).map((d) => new Object({id: d.id, name: d.name, latency: true})), period, downsample, callback);

	let dl = device_list.map(function (d) {
		let varbind_list = d.varbind_list.filter((v) => v.tag_list.indexOf(tag) != -1 && v.is_history && !v.is_temporary).map((v) => new Object({id: v.id, name: v.name})); 
		return {id: d.id, name: d.name, latency: false, varbind_list};
	});

	history.get(dl, period, downsample, callback);
}

function getValue(opts, callback) {
	if (!opts.address)	
		return callback(new Error('Address is empty'));

	if (opts.protocol == 'expression') {
		let device = Device.get(opts.device_id);
		if (!device)	
			return callback(new Error('Bad device id'));

		let res;
		try {
			let expressionCode = Varbind.generateExpressionCode(device, opts.address && opts.address.expression);
			res = eval(expressionCode);
			res = applyDivider(res, opts.divider);
		} catch (err) {
			res = 'ERR: ' + err.message;
		}
		return callback(null, res);
	}	 

	if (!opts.protocol || !protocols[opts.protocol])
		return callback(new Error('Unsupported protocol'));

	protocols[opts.protocol].getValues(opts.protocol_params, [opts.address], function(err, res) {
		callback(null, (err) ? 'ERR: ' + err.message : (res[0].isError) ? 'ERR: ' + res[0].value : applyDivider(res[0].value, opts.divider));
	})
}

function discovery (opts, callback) {
	if (!protocols[opts.protocol] || !protocols[opts.protocol].discovery)
		return callback(new Error('Unsupported'));

	function loadRule(rule) {
		try {
			return JSON.parse(fs.readFileSync(`./discovery/${opts.protocol}.${rule}.json`, {encoding: 'utf-8'}).toString());
		} catch (err) {
			return;
		}	 
	}

	let rule_list = loadRule(opts.rule);
	if (!rule_list)
		return callback(new Error('Corrupted discovery file'));

	rule_list
		.filter((rule) => typeof(rule) == 'string')
		.forEach(function (rule) {
			let r = loadRule(rule) || [];
			rule_list.push.apply(rule_list, r);
		});

	rule_list = rule_list.filter((rule) => typeof(rule) != 'string' && !!rule);

	protocols[opts.protocol].discovery(opts, rule_list.map((rule) => rule.enum), function (err, result) {
		if (err)
			return callback(err);

		let varbind_list = [];
		rule_list.forEach(function (rule, i) {
			let element_list = result[i] || [];
			let props = {};
			element_list.forEach((e) => Object.keys(e).forEach((prop) => props[prop] = true));
			['enum', 'filter', 'transform'].forEach(function (attr) {
				if (rule[attr] instanceof Object)
					Object.keys(rule[attr]).forEach((prop) => props[prop] = true);
			});
			props = Object.keys(props);

			element_list.forEach(function (element) {
				let replace = (str, src) => props.reduce((res, prop) => res.replace(new RegExp('{' + prop + '}', 'g'), src ? `(element.${prop} || '')` : (element[prop] + '')), str || '') || '';

				if (rule.filter) {
					let test = replace(rule.filter, true);
					try {
						if (!eval(test))
							return;
					} catch(err) {
						return console.error([__filename, 'Discovery filter error: ' + err.message, 'FILTER: ' + rule.filter + '\n', 'EVAL: ' + test + '\n'].join('\n'), element);
					}
				}

				for (let prop in rule.transform || {}) {
					let transform = replace(rule.transform[prop], true);
					try {
						element[prop] = eval(transform);
					} catch (err) {
						return console.error([__filename , 'Discovery transform error: ' + err.message, 'TRANSFORM: ' + rule.transform[prop], 'EVAL: ' + transform].join('\n'), element);
					}
				}
				rule.prototypes.forEach(function (proto) {
					let address = Object.assign({}, proto.address);
					for (let p in address)
						address[p] = replace(proto.address[p]);

					varbind_list.push({
						name: replace(proto.name),
						address,
						divider: replace(proto.divider) || 1,
						value_type: proto.value_type || 'number',
						condition: proto.condition || '',
						tags: proto.tags || ''
					});
				});	
			});	
		});

		protocols[opts.protocol].getValues(opts, varbind_list.map((v) => v.address), function (err, values) {
			if (err)
				return callback(err);

			varbind_list.forEach((v, i) => v.value = applyDivider(values[i].value, v.divider));
			varbind_list = varbind_list.filter((v, i) => !values[i].isError);
			callback(null, varbind_list);
		});
	});
}

function Device() {
	this.__type__ = 'device';
	this.varbind_list = [];
	this.status = 0;
	this.latency = null;
	Object.defineProperty(this, 'is_status', {get: () => this.varbind_list.some((v) => v.is_status)});
	Object.defineProperty(this, 'alive', {get: () => this.is_pinged && +this.latency == this.latency || !this.is_pinged});
}

// Device.prototype.toJSON = function () {}

Device.prototype.setAttributes = function (data) {
	Object.assign(this, data);
	if (this.id) 
		this.id = parseInt(this.id);

	this.force_status_to = parseInt(this.force_status_to) || 0;

	['name', 'ip', 'mac', 'description'].forEach((prop) => this[prop] = (this[prop] || '').trim());
	this.timeout = parseInt(this.timeout) || 3;
	this.name = this.name || 'Unnamed';

	try {
		this.protocols = data.json_protocols && JSON.parse(data.json_protocols) || {};
		delete this.protocols.expression;
		for (let protocol in this.protocols)
			this.protocols[protocol].timeout = this.timeout;
	} catch (err) {
		this.json_protocols = '{}';
		this.protocols = {};
		console.error(__filename, err);
	}

	if (!this.json_varbind_list)
		this.json_varbind_list = '[]';

	this.tag_list = !!this.tags ? this.tags.toString().split(';').map((t) => t.trim()).filter((t, idx, tags) => tags.indexOf(t) == idx) : [];
	this.tags = this.tag_list.join(';');
	this.is_pinged = parseInt(this.is_pinged);
		
	return this;
}

Device.prototype.cache = mixin.cache;

Device.prototype.updateStatus = function () {
	this.prev_status = this.status;
	this.status = (this.is_status) ? this.varbind_list.reduce((max, e) => Math.max(max, e.status || 0), 0) : this.status;
	return this;
}

Device.prototype.updateVarbindList = function () {
	let collator = new Intl.Collator();
	this.varbind_list = mixin.get('varbind').getList().filter((v) => v.device_id == this.id).sort(collator.compare) || [];
	return this;
}

Device.prototype.getHistory = function (period, only_varbind_id, downsample, callback) {
	let varbind_list = this.varbind_list
		.filter((v) => v.is_history && !v.is_temporary && (!only_varbind_id || v.id == only_varbind_id))
		.map((v) => new Object({id: v.id, name: v.name}));
	history.get([{id: this.id, name: this.name, latency: false, varbind_list}], period, downsample, callback);
}

Device.prototype.getChanges = function (period, callback) {
	let device = this;
	let from = period[0];
	let to = period[1];
	let ids = device.varbind_list.filter((v) => !v.is_history && !v.is_temporary).map((v) => v.id).join(', ');

	db.all(
		`select start_date, end_date, varbind_id, prev_value, value, status from changes.device${device.id} where varbind_id in (${ids}) and (
			start_date <= ${from} and (end_date >= ${from} or end_date is null) or 
			start_date >= ${from} and (end_date <= ${to} or end_date is null) or 
			start_date <= ${to} and (end_date >= ${to} or end_date is null))`, 
		function (err, rows) {
			if (err)
				return callback(err);
	
			let time = new Date().getTime();	
			let res = rows.map((row) => [row.start_date, row.end_date || time, row.varbind_id, row.prev_value, row.value, row.status]);
			callback(null, res);
		}
	);
}

Device.prototype.updateParent = function (callback) {
	let device = this;
	if (!device.ip) {
		device.parent_id = null;
		return callback(null, null);		
	}

	network.trace(device.ip, function(err, ips) {
		if (err || !ips || !ips.length) {
			device.parent_id = null;
			return callback(null, null);			
		}
			
		let res;
		Device.getList().forEach(function(d) {
			let hop = ips.indexOf(d.ip);
			if (hop == -1)
				return;
	
			if (!res || res.hop < hop && device.ip != d.ip && d.is_pinged)
				res = {hop, parent: d};
		});
	
		let parent = res && res.parent || null;
		let parent_id = parent ? parent.id : null;
		db.run('update devices set parent_id = ? where id = ?', [parent_id, device.id], function (err) {
			if (err) 
				return callback(err);
	
			device.parent_id = parent_id;
			callback(null, parent);
		});
	})
}

Device.prototype.polling = function (delay) {
	let device = this;
	
	if (timers[device.id]) {
		clearTimeout(timers[device.id]);
		delete timers[device.id];
	}

	if ((!device.varbind_list || device.varbind_list.length == 0) && !device.is_pinged)
		return;

	if (delay > 0)
		return timers[device.id] = setTimeout(() => device.polling(), delay);

	if (device.is_pinged && delay != -1) {
		network.ping(device.ip, function(err, latency) {
			device.latency = err ? 'N/A' : latency;
			let prev_prev_status = device.prev_status;

			if (isNaN(device.latency)) {
				device.prev_status = device.status;
				device.status = device.force_status_to;
			}

			if (!isNaN(device.latency) && device.varbind_list.length == 0) {
				device.prev_status = device.status;
				device.status = 1;
			}

			if (isNaN(device.latency) || device.varbind_list.length == 0) {
				events.emit('status-updated', device);
				if (prev_prev_status != undefined && device.prev_status != device.status)
					events.emit('status-changed', device, new Date().getTime(), 'ERR: ping');
			}

			if (device.varbind_list.length == 0)
				return device.polling(device.period * 1000 || 60000); // reset polling

			if (!isNaN(device.latency))
				return device.polling(-1); // continue polling
	
			device.varbind_list.forEach(function (varbind) {	
				varbind.prev_value = varbind.value;
				varbind.value = 'N/A';
				varbind.prev_status = varbind.status;
				varbind.status = 0;
			});
			
			device.saveValues(new Date().getTime(), () => device.polling(device.period * 1000 || 60000)); // reset polling					
		})
		return;
	}

	let values = {};
	let errors = [];
	async.eachOfSeries(protocols, function(protocol, protocol_name, callback) {
			let opts = device.protocols[protocol_name];
			let varbind_list = device.varbind_list.filter((v) => v.protocol == protocol_name);
			let address_list = varbind_list.map((v) => v.address);

			if (address_list.length == 0 || !opts)
				return callback();

			opts.ip = device.ip;	
			protocol.getValues(opts, address_list, function(err, res) {
				if (err) {
					errors.push(err);
					varbind_list.forEach((v, i) => values[v.id] = {isError: true, value: err.message});
				} else if (!err && res.length && res.every((r) => r.isError)) {
					err = new Error(res[0] && res[0].value || 'Unknown');
					errors.push(err);
					varbind_list.forEach((v, i) => values[v.id] = {isError: true, value: res[i] && res[i].value || err.message});
				} else {
					errors.push(false);
					varbind_list.forEach((v, i) => values[v.id] = res[i]);
				}

				callback();
			})
		}, 
		function (err) {
			let time = new Date().getTime();

			function update (varbind) {
				let value = (varbind.is_expression) ? varbind.calcExpressionValue() : values[varbind.id].value;
				let isError = varbind.is_expression && value instanceof Error || !varbind.is_expression && values[varbind.id].isError;
				value = (isError) ? 'ERR: ' + value : applyDivider (value, varbind.divider);

				varbind.prev_value = varbind.value;
				varbind.value = value;
				varbind.updateStatus();	

				for(let i in varbind.stores) 
					varbind.stores[i].push(varbind.value);

				varbind.prev_value_time = varbind.value_time;
				varbind.value_time = time;
			}

			device.varbind_list.filter((v) => values[v.id] !== undefined && !v.is_expression).forEach(update);
			device.varbind_list.filter((v) => v.is_expression).forEach(update);

			let isError = errors.length && errors.every((e) => e instanceof Error) && (device.is_pinged && isNaN(device.latency) || !device.is_pinged);
			if (isError) {
				device.prev_status = device.status;
				device.status = device.force_status_to;
			} else {
				if (device.is_status)
					device.updateStatus();
				else 
					device.status = 1;
			}

			events.emit('status-updated', device, time);
			events.emit('values-updated', device, time);

			if (device.prev_status != device.status) 
				events.emit('status-changed', device, time, isError ? 'ERR: ' + errors.map((e) => e.message).join('; ') : null);

			device.saveValues(time, () => device.polling(device.period * 1000 || 60000));
		}
	) 
}

Device.prototype.saveValues = function (time, callback) {
	let device = this;

	let query_list = [];
	let params_list = [];

	if (device.latency == 'N/A') {
		query_list.push('update varbinds set value = prev_value, status = 0, value = ? where device_id = ?');
		params_list.push(['N/A', device.id]);	
	} else {
		device.varbind_list
			.filter((v) => !v.is_temporary && (v.value != v.prev_value || v.status != v.prev_status))
			.forEach(function (v) {
				query_list.push('update varbinds set value = ?, prev_value = ?, status = ? where id = ?'); 
				params_list.push([v.value, v.prev_value, v.status || 0, v.id]);
			});
	}

	// number
	let columns = (device.is_pinged) ? ['time', 'latency'] : ['time'];
	let params = (device.is_pinged) ? [time, device.latency] : [time];

	let varbind_list = device.varbind_list.filter((v) => !v.is_temporary && v.is_history);

	varbind_list
		.filter((v) => v.value != undefined)
		.forEach(function(v) {			
			columns.push(`varbind${v.id}`);
			params.push(v.value);

			if (!v.is_status)
				return;

			columns.push(`varbind${v.id}_status`);			
			params.push(v.status);
		});

	db.push(`insert into history.device${device.id} (${columns.join(',')}) values (${'?, '.repeat(columns.length - 1) + '?'})`, params);

	// Other types
	device.varbind_list
		.filter((v) => !v.is_temporary && !v.is_history && v.prev_value != v.value)
		.forEach(function(v) {
			if (v.value_type == 'duration' && !isNaN(v.prev_value) && !isNaN(v.value) && (v.value - v.prev_value) > 0)
				return;

			db.push(`update changes.device${device.id} set end_date = ? where varbind_id = ? and end_date is null`, [time - 1, v.id]);
			db.push(`insert into changes.device${device.id} (varbind_id, prev_value, value, status, start_date) values (?, ?, ?, ?, ?)`, 
				[v.id, v.prev_value == undefined ? null : v.prev_value, v.value == undefined ? null : v.value, v.status, time]);
		});

	callback();
}

Device.prototype.delete = function (callback) {
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

			events.emit('device-deleted', device);		
			device.varbind_list.forEach((varbind) => varbind.cache('CLEAR'));
			device.varbind_list = [];
			device.polling();
			device.cache('CLEAR');

			function drop(where, callback) {
				db.run(`drop table ${where}.device${device.id}`, function (err) {
					if (err)
						console.error(__filename, err.message);
					callback();
				})
			}

			async.eachSeries(['history', 'changes'], drop, callback);
		}
	)
}

Device.prototype.save = function (callback) {
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
			db.upsert(device, ['name', 'description', 'tags', 'ip', 'mac', 'json_protocols', 'is_pinged', 'period', 'timeout', 'force_status_to'], callback);
		},

		function (callback) {
			try {
				varbind_list = JSON.parse(device.json_varbind_list).map(function (v) {
					if (isNew && v.id)
						delete v.id;
					v.name = v.name || 'Unnamed';
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
				(varbind, callback) => db.upsert(varbind, ['device_id', 'name', 'protocol', 'json_address', 'divider', 'value_type', 'condition_id', 'tags', 'updated'], callback), 
				callback
			);
		},

		function (callback) { 
			let sql = 'select id from varbinds where device_id = ? and updated <> ? and check_id is null';
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
			let ids = delete_varbind_ids.filter((id) => (Varbind.get(id) || {}).is_history)
			if (!ids.length)	 
				return callback();

			let set = ids.map((id) => `varbind${id} = null, varbind${id}_status = null`).join(', ');
			db.run(`update history.device${device.id} set ${set}`, callback);
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
		device.updateVarbindList();
		device.prev_status = 0;
		device.status = 0;

		if (!!device.parent_id)
			device.updateParent((err) => (err) ? console.error(err) : null);

		events.emit('device-updated', device, time);
		device.polling(2000);

		db.checkHistoryTable(device, (err) => callback(err, device.id));
	});
}

Device.prototype.getParent = function () {
	return Device.get(this.parent_id);
}

// divider is a "number" or "number + char" or "number + r + regexp"
function applyDivider (value, divider) {
	if (typeof(value) === 'boolean')
		return value;

	if (isNaN(value)) {
		value += '';

		// Don't change error-values
		if (value.indexOf('ERR') == 0)
			return value;

		// Don't change any text with spaces
		if (value.indexOf(' '))
			return value;

		// Force to number
		let comma_count = (value.match(/,/g) || []).length;
		let point_count = (value.match(/\./g) || []).length;
		if (point_count == 0 && comma_count == 1) // '123,4' to 123.4
			return applyDivider(parseFloat(value.replace(',', '.')), divider);

		if (point_count == 1 && comma_count > 0) // '1,234.5' to 1234.5
			return applyDivider(parseFloat(value.replace(',', '')), divider);
	}

	// Extract and apply regexp, e.g 123rMemory(\d+)
	if (/^([\d.]+)r/g.test(divider + '')) {	
		value += '' 
		divider += '';
		let pos = divider.indexOf('r'); 

		let re, error, val;
		try {
			re = new RegExp(divider.substring(pos + 1));
			val = (value + '').match(re);
		} catch (err) {
			error = err;
		}
		
		return (error) ? error.message : val && val[1] ? applyDivider(val[1], parseFloat(divider)) : '';
	}

	// Percent: value 500, divider: 5p300 = 33
	if (!isNaN(value) && /^([\d.]+)P([\d.]+)$/g.test(divider + '')) {
		divider += '';
		let pos = divider.indexOf('P');

		value = 100 * value / parseFloat(divider.substring(0, pos)) / parseFloat(divider.substring(pos + 1));
		return Math.round(value);
	}	

	// Reverse percent: value 500, divider: 5p300 = 66
	if (!isNaN(value) && /^([\d.]+)p([\d.]+)$/g.test(divider + '')) {
		divider += '';
		let pos = divider.indexOf('p');

		value = 100 - 100 * value / parseFloat(divider.substring(0, pos)) / parseFloat(divider.substring(pos + 1));
		return Math.round(value);
	}	

	// Round: value 123.456, divider 10R2 = 12.34
	if (!isNaN(value) && /^([\d.]+)R([\d]*)$/g.test(divider + '')) {
		let pos = divider.indexOf('R');
		value = parseFloat(value) / parseFloat(divider.substring(0, pos));
		return value.toFixed(parseInt(divider.substring(pos + 1) || 0));
	}
	
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

	return val;
}

module.exports = Device;