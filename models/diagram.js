'use strict'
const db = require('../modules/db');
const mixin = require('./mixin');

const Device = require('./device');
const Varbind = require('./varbind');

Object.assign(Diagram, mixin.get('diagram'), {cache});

function cache(callback) {
	db.all('select * from diagrams', function (err, rows) {
		if (err)
			return callback(err);

		rows.forEach((r) => (new Diagram()).setAttributes(r).cache().updateStatus());
		callback();
	})
}

function Diagram () {
	this.__type__ = 'diagram';	
	this.element_list = [];
	this.devices = {};
	this.name = '';
	this.prev_status = 0;
	this.status = 0;
}

Diagram.prototype.updateStatus = function() {
	if (!this.element_list.length)
		return; 

	this.prev_status = this.status;
	this.status = Math.max.apply(Math.max, this.element_list.filter((e) => e.type != 'diagram').map((e) => e.status || 0)) || 0;
}

Diagram.prototype.setAttributes = function (data) {
	Object.assign(this, data);
	try {
		this.element_list = JSON.parse(data.json_element_list);

		this.element_list
			.filter((e) => e.type == 'diagram' && e['diagram-id'])
			.forEach(function(e) {
				var diagram = Diagram.get(parseInt(e['diagram-id']));
				if (!diagram)
					return;

				Object.defineProperty(e, 'status', {get: () => diagram.status || 0, enumerable: true});
				Object.defineProperty(e, 'path', {get: () => diagram.name, enumerable: true});
			});

		this.element_list
			.filter((e) => e.type != 'diagram' && e['device-id'])
			.forEach(function(e) {
				Object.defineProperty(e, 'device_id', {
					get: () => e['device-id'],
					set: (id) => e['device-id'] = id
				});
	
				Object.defineProperty(e, 'varbind_id', {
					get: () => e['varbind-id'],
					set: (id) => e['varbind-id'] = id
				});
	
				let device = e.device_id && Device.get(e.device_id);
				let varbind = e.varbind_id && Varbind.get(e.varbind_id);
	
				if (device && !varbind) {
					Object.defineProperty(e, 'status', {get: () => device.status || 0, enumerable: true});
					Object.defineProperty(e, 'path', {get: () => device.name, enumerable: true});
				}
	
				if (device && varbind) {
					Object.defineProperty(e, 'status', {get: () => varbind.status || 0, enumerable: true});
					Object.defineProperty(e, 'value', {get: () => varbind.value, enumerable: true});
					Object.defineProperty(e, 'value_type', {get: () => varbind.value_type, enumerable: true});
					Object.defineProperty(e, 'path', {get: () => device.name + '/' + varbind.name, enumerable: true});
				}	 				
			});

	} catch (err) {
		console.error(__filename, err.message);
		this.json_element_list = '[]';
		this.element_list = [];
	}

	this.devices = this.element_list.reduce(function (res, e) {
		if (e.device_id)
			res[e.device_id] = true;
		return res;
	}, {});

	return this;
}

Diagram.prototype.cache = mixin.cache;

Diagram.prototype.delete = function (callback) {
	let diagram = this;
	db.run('delete from diagrams where id = ?', [diagram.id], function (err) {
		if (err)
			return callback(err);

		diagram.cache('CLEAR');
		callback();
	})
}

Diagram.prototype.save = function (callback) {
	var diagram = this;
	db.upsert(diagram, ['name', 'json_element_list'], function (err) {
		if (err)	
			return callback(err);

		diagram = diagram.cache();
		diagram.updateStatus();	
		callback(null, diagram.id);
	});
}

module.exports = Diagram;