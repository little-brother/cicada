'use strict'
const db = require('../modules/db');
const mixin = require('./mixin');

Object.assign(Condition, mixin.get('condition'), {purge});

const check = {
	'>' : (v, v1) => !isNaN(v) && !isNaN(v1) && parseFloat(v) > parseFloat(v1),
	'>=' : (v, v1) => !isNaN(v) && !isNaN(v1) && parseFloat(v) >= parseFloat(v1),
	'=' : (v, v1) => v == v1,
	'<>' : (v, v1) => v != v1,
	'<' : (v, v1) => !isNaN(v) && !isNaN(v1) && parseFloat(v) < parseFloat(v1),
	'<=' : (v, v1) => !isNaN(v) && !isNaN(v1) && parseFloat(v) <= parseFloat(v1),
	'empty' : (v) => isNaN(v) && !v,
	'change' : (v, prev) => prev != undefined && v != undefined && prev != v,
	'any' : (v, v1) => true,
	'error' : (v) => (v + '').indexOf('ERR') == 0
}

function purge(callback) {
	db.all('select id from conditions where id not in (select distinct coalesce(condition_id, -1) from varbinds)', function (err, rows) {
		if (err)
			return callback(err);

		if (!rows.length)
			return callback();

		let ids = rows.map((row) => row.id);
		ids.forEach(function (id) {
			let condition = Condition.get(id);
			if (condition)
				condition.cache('CLEAR');
		});
		db.run(`delete from conditions where id in (${ids.join(', ')})`, callback);
	});
}

function Condition () {
	this.__type__ = 'condition';	
	this.name = '';
	this.gap = 0;
	this.condition_list = [];
}

Condition.prototype.toJSON = function () {
	return {
		id: this.id,
		name: this.name,
		gap: this.gap,
		condition_list: this.condition_list || []
	};
}

Condition.prototype.cache = mixin.cache;

Condition.prototype.calcStatus = function (value, prev_value, prev_status) {
	let gap = this.gap; 
	let fv = parseFloat(value);
	let status = 0;

	for (let i = 0; i < this.condition_list.length; i++) {
		let cond = this.condition_list[i];	

		let fv1 = parseFloat(cond.value); 
		if (!isNaN(fv1) && cond.status == prev_status && Math.abs(fv - fv1) <= gap) {
			status = prev_status;
			break;	
		}

		if (cond.if == 'change' && check.equals(value, prev_value)) {
			status = cond.status;
			break;
		}
		 
		if (check[cond.if] && check[cond.if](value, cond.value)) {
			status = cond.status;
			break;
		}
	} 	

	return status;
}

Condition.prototype.setAttributes = function (data) {
	Object.assign(this, data);
	if (this.id) 
		this.id = parseInt(this.id);

	this.gap = parseFloat(this.gap) || 0;
	try {
		this.condition_list = JSON.parse(this.json_condition_list) || [];
	} catch (err) {
		this.json_condition_list = '[]';
		this.condition_list = [];
	}

	return this;
}

Condition.prototype.save = function (callback) {
	let condition = this;
	let isNew = !this.id; 
	let time = new Date().getTime();

	if (!condition.name)
		return callback(new Error('Name is required'));

	db.upsert(condition, ['name', 'gap', 'json_condition_list'], function (err) {
		if (err)	
			return callback(err);

		condition = condition.cache();
		callback(null, condition.id);
	});
}

module.exports = Condition;