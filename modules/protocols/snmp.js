'use strict'
const snmp = require('net-snmp');
const ver = {'1' : snmp.Version1, '2c' : snmp.Version2c};

// opts = {version: 2c, community: public, port: 161, timeout: 3}
// address = {oid: 1.3.6.1.2.1.1.3.0}
exports.getValues = function(opts, address_list, callback) {
	if (ver[opts.version] == undefined)
		return callback(new Error('Unsupported version of snmp: ' + opts.version));

	let session = snmp.createSession (opts.ip, opts.community, {
		port: opts.port, 
		version: ver[opts.version], 
		timeout: opts.timeout * 1000 || 3000
	});

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

// opts = {ip: 128.33.12.34, port: 162, write_community: private, version: 2c, timeout: 3 }
// action = {oid: '1.2.3', type: 2, value: 10}
exports.doAction = function(opts, action, callback) {
	if (ver[opts.version] == undefined)
		return callback('Unsupported version of snmp: ' + opts.version);

	let session = snmp.createSession (opts.ip, opts.community_write, {
		port: opts.port, 
		version: ver[opts.version], 
		timeout: parseInt(opts.timeout) * 1000 || 3000
	});

	session.set ([{
		oid: action.oid, 
		type: (action.value_type in snmp.ObjectType) ? snmp.ObjectType[action.value_type] : 2, // 2 - Integer
		value: action.value
		}], 
		function (err, res) {
			closeSession(session);
			callback(err && err.message || '');
		}
	);	
}

function closeSession(session) {
	try { 
		session.close(); 
	} catch(err) { 
		console.log('SNMP session close: ', err); 
	}
}