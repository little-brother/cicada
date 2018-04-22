'use strict'
const snmp = require('net-snmp');
const ver = {'1' : snmp.Version1, '2c' : snmp.Version2c};

// opts = {version: 2c, community: public, port: 161, timeout: 3}
// address = {oid: 1.3.6.1.2.1.1.3.0}
exports.getValues = function(opts, address_list, callback) {
	if (ver[opts.version] == undefined)
		return callback(new Error('Unsupported version of snmp: ' + opts.version));

	if (address_list.some((a) => !a.oid))
		return callback(new Error('Oid is empty!'));

	let session = openSession(opts);

	function parseValue(value, type, hint) {
		// Opaque 4 byte 
		if (type == snmp.ObjectType.Opaque && value instanceof Buffer && value.length == 7) 
			value = Buffer.from(value.slice(3)).readFloatBE();

		// MAC
		if (hint == 'MAC' && value instanceof Buffer && value.length == 6) {
			let res = [];
			for (let i = 0; i < 6; i++)
				res.push(value[i].toString('16').toUpperCase());
			return res.map((e) => e.length == 1 ? '0' + e : e).join(':');
		}

		return isNaN(value) ? value.toString() : value;
	}

	let res = new Array(address_list.length);
	if (opts.version == 1) {
		function getValue(i) {
			if (i == address_list.length) {
				closeSession(session);
				return callback(null, res);
			}

			let address = address_list[i].oid; 
			session.get([address], function(err, rows){
				if (err && err instanceof snmp.RequestTimedOutError && i == 0)
					return callback(err);

				res[i] = {
					value: (err) ? err.message : parseValue(rows[0].value, rows[0].type, address_list[i].hint),
					isError: !!(err)
				};
	
				getValue(i + 1);
			});
		}
	
		getValue(0);
	}

	if (opts.version == '2c') {
		session.get (address_list.map((a) => a.oid), function (err, rows) {
			closeSession(session);

			if (err)
				return callback(err);

			res = address_list.map(function(address, i) {
				return {
					value:  snmp.isVarbindError(rows[i]) ? snmp.varbindError(rows[i]) : parseValue(rows[i].value, rows[i].type, address.hint),
					isError: !!snmp.isVarbindError(rows[i])
				}
			});

			callback(null, res);
		});
	}
}

// opts = {ip: 128.33.12.34, port: 161, community: public, version: 2c, timeout: 3}
// rule_list = [{STATUS: 1.3.6..., DESC: 1.3.6...}]
// rule_list = [1.3.6..., ...] ~ [{VALUE: 1.3.6...}, ...] 
exports.discovery = function (opts, enum_list, callback) {
	let session = openSession(opts);

	let enum_oids = {};	
	enum_list.forEach((e, i) => enum_list[i] = (typeof(e) == 'string') ? {VALUE: e} : e);
	enum_list.forEach(function (e) {
		for (let prop in e) 
			enum_oids[e[prop]] = [];
	});

	let enum_oid_list = Object.keys(enum_oids);
	function enumOid (i) {
		if (i == enum_oid_list.length) 
			return onDone();

		let oid = enum_oid_list[i];
		session.subtree (oid,
			(list) => list.filter((e) => !snmp.isVarbindError(e)).forEach((e) => enum_oids[oid].push({index: e.oid.substring(oid.length + 1), value: e.value})), 
			function (err) {
				if (err)
					enum_oids[oid] = [];
				enumOid(i + 1);
			}
		);
	}
	enumOid(0);

	function onDone() {
		closeSession(session);

		let res = enum_list.map(function(e) {
			let elements = {};
			for (let prop in e) {	
				enum_oids[e[prop]].forEach(function (e) {
					if (!elements[e.index])
						elements[e.index] = {INDEX: e.index};
	
					elements[e.index][prop] = e.value.toString();	
				});
			}
			return Object.keys(elements).map(idx => elements[idx]);	
		});
		callback(null, res);
	}	
}

function openSession(opts) {
	return snmp.createSession (opts.ip, opts.community, {
		port: opts.port, 
		version: ver[opts.version], 
		timeout: opts.timeout * 1000 || 3000
	});
}

function closeSession(session) {
	try { 
		session.close(); 
	} catch(err) { 
		console.log('SNMP session close: ', err.message); 
	}
}