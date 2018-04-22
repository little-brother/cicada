'use strict'
const exec = require('child_process').exec;

let is_enable = false;
exec('wmic /?', (err) => is_enable = !err || !console.log('WMI is not available'));

// opts = {user: Home, password: mypassword, ip: localhost, timeout: 3}
// address = {alias: cpu, property: caption}
// address = {alias: logicdisk, property: name@1}
exports.getValues = function(opts, address_list, callback) {
	if (!is_enable)
		return callback(new Error('Require WMIC'));

	let res = new Array(address_list.length);

	function reduceItem (item, line) {
		let pair = line.split('=');
		if (pair[0])
			item[pair[0].toLowerCase()] = pair[1];
		return item;	
	}

	function stringify(obj) {
		let res = [];
		for (let prop in obj)
			res.push(`${prop}: ${obj[prop]}`);
		return res.join(', ');
	}

	function getValue(i) {
		if (i == address_list.length) 
			return callback(null, res);

		let auth = (!!opts.user) ? `/user:${opts.user} /password:${opts.password}` : '';
		let host = (!!opts.ip) ? opts.ip : 'localhost';

		let property = address_list[i].property || '';
		let idx = property ? property.indexOf('@') : -1;
		let num = idx != -1 ? address_list[i].property.substring(idx + 1) : NaN;
		if (num != 'count')
			num = parseInt(num) - 1;

		let prop = idx == -1 ? property : property.slice(0, idx);
		prop = prop.toLowerCase();

		let command = `wmic ${auth} /node:${host} ${address_list[i].alias} get ${prop} /format:value`;
		command = command.replace(/\\/g, '\\\\'); 
		
		exec(command, {timeout: opts.timeout * 1000 || 3000}, function(err, stdout, stderr) {
			let isErrorAlias = !!err && err.message.indexOf('Alias not found') != -1;
			let isErrorQuery = !!err && err.message.indexOf('Invalid query') != -1;
			let isErrorTimeout = !!err && err.killed;

			// Fix Node bug
			if (err && err.message.indexOf('Command failed') !=- 1 && !stderr && !stdout)
				return getValue(i);

			if (i == 0 && err && !(isErrorAlias || isErrorQuery))
				return callback(isErrorTimeout ? new Error('Timeout') : err);

			let value = isErrorAlias ? 'Alias not found' : isErrorQuery ? 'Invalid query' : '';
			if (!isErrorAlias && !isErrorQuery) {
				let item_list = stdout.split('\n')
					.map((e) => e.trim())
					.join('|')
					.split('||')
					.filter((e) => !!e)
					.map((e) => e.split('|').reduce(reduceItem, {}));

				value = num == 'count' ? value = item_list.length :
					!isNaN(num) && item_list[num] && prop ? item_list[num][prop] || '' :
					!isNaN(num) && item_list[num] && !prop ? stringify(item_list[num]) :
					!isNaN(num) && !item_list[num] ? value = '' :
					isNaN(num) && prop ? item_list.map((e) => e[prop]).join('; ') :
					isNaN(num) && !prop ? JSON.stringify(item_list) :
					'???';
			}

			res[i] = {
				value, 
				isError: isErrorAlias || isErrorQuery
			};
			getValue(i + 1);				
		})			
	}

	getValue(0);
}

exports.discovery = function (opts, enum_list, callback) {
	let res = new Array(enum_list.length);

	function enumItem (i) {
		if (i == enum_list.length) 
			return callback(null, res);

		let e = enum_list[i];
		exports.getValues(opts, [{alias: e}], function (err, values) {
			let element_list;

			try {
				element_list = !err ? JSON.parse(values[0].value) : [];
			} catch (error) {
				err = error;
			}

			res[i] = err || !(element_list instanceof Array) ? [] : element_list;
			res[i].forEach((e, i) => e.INDEX = i + 1);
			enumItem (i + 1);
		});
	}
	enumItem(0);
}

exports.doAction = function(opts, action, callback) {
	return callback('Unsupported');
}