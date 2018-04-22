'use strict'
const async = require('async');
const RRStore = require('rrstore');

const mixin = require('./mixin');
const Condition = require('./condition');

Object.assign(Varbind, mixin.get('varbind'), {generateExpressionCode});

function Varbind (data) {
	if (this.json_address != data.json_address)
		this.stores = {};

	// Support of avg, min and max values and forecast
	let self = this;
	function getStore(size) {
		size = parseInt(size) || 1;
		if (!self.stores[size]) {
			self.stores[size] = new RRStore(size);
			self.stores[size].push(self.value);
		}

		return self.stores[size];
	}
	['avg', 'min', 'max', 'sum'].forEach((e) => this[e] = (size) => getStore(size)[e]);
	this.get = (size) => getStore(size);
	this.forecast = (size, when, method) => getStore(size).forecast(when, method);

	Object.assign(this, data);
	if(this.id)
		this.id = parseInt(this.id);

	this.__type__ = 'varbind';
	this.cache = mixin.cache;
	if (!this.value_type)
		this.value_type = 'string';
	this.name = this.name + '';
	this.condition_id = parseInt(this.condition_id) || 0;

	try {
		this.address = JSON.parse(this.json_address) || {};
	} catch (err) {
		this.json_address = '{}';
		this.address = {};
	}
		
	this.tag_list = !!this.tags ? this.tags.toString().split(';').map((t) => t.trim()).filter((t, idx, tags) => tags.indexOf(t) == idx) : [];
	this.tags = this.tag_list.join(';');

	Object.defineProperty(this, 'is_history', {get: () => this.value_type == 'number' || this.value_type == 'size'});
	Object.defineProperty(this, 'is_status', {get: () => !!this.condition_id});
	Object.defineProperty(this, 'is_temporary', {get: () =>  this.name[0] == '$'});
	Object.defineProperty(this, 'is_expression', {get: () => this.protocol == 'expression'});
	if (this.is_expression)
		this.expressionCode = '';

	Object.defineProperty(this, 'speed', {get: () => 1000 * (this.value - this.prev_value)/(this.value_time - this.prev_value_time)});
}

Varbind.prototype.getParent = function() {
	return mixin.get('device').get(this.device_id);
}

Varbind.prototype.updateStatus = function() {
	if (!this.condition_id)
		return; 

	this.prev_status = this.status;
	let condition = Condition.get(this.condition_id);
	this.status = condition ? condition.calcStatus(this.value, this.prev_value, this.status) : 0;
}

function generateExpressionCode (curr_device, expression) {
	if (!expression)
		return '';

	let expr = (expression + '').replace(/\n/g, '');
	expr = expr.replace(/(\$\[([^\]]*)\]|\$(\w*))/g, function(matched, p1, p2, p3, pos, exp) {
		let names = (p2 || p3 || '').split('=>').map((name) => (name || '').trim());
		let device = (names.length == 1) ? curr_device : mixin.get('device').getList().find((d) => d.name == names[0]) || {varbind_list: []};
		let name = (names.length == 1) ? names[0] : names[1];
		if (name[0] == '@') {
			let prop = name.substring(1);
			return (device[prop] !== undefined) ? `(mixin.get('device').get(${device.id}) || {}).${prop}` : ' null ';
		}
		
		let varbind = device.varbind_list.find((v) => v.name == name);
		return (!!varbind) ? `Varbind.get(${varbind.id})${exp[pos + matched.length] == '.' ? '' : '.value'}` : ' null ';
 	});

 	return expr;
}

Varbind.prototype.calcExpressionValue = function () {
	if (!this.expressionCode)
		this.expressionCode = generateExpressionCode(this.getParent(), this.address && this.address.expression);	

	let result;
	try {
		let val = eval(this.expressionCode);
		let float = parseFloat(val);
		result = (float == val) ? float : val;
	} catch (err) {
		result = err;
	}
	return result;
}

// Forecast value by linear regression
RRStore.prototype.forecast = function (when) {
	let arr = this.arr.map((e, i) => [i, e]).filter((e) => !isNaN(e[1]));

	if (arr.length == 0)
		return null;	

	let mean = (arr) => arr.reduce((sum, e) => sum + e, 0) / arr.length;
	let res = null;

	let x = arr.map((e) => e[0]);
	let y = arr.map((e) => e[1]);
	let meanX = mean(x);
	let meanY = mean(y);		

	let beta = arr.reduce((sum, e) => sum + (e[0] - meanX) * (e[1] - meanY), 0) / arr.reduce((sum, e) => sum + (e[0] - meanX) * (e[0] - meanX), 0);
	let alpha = meanY - beta * meanX;

	// y = beta * x + alpha
	return beta * (arr.length + when - 1) + alpha;
}

module.exports = Varbind;