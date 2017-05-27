'use strict'
const ModbusRTU = require('modbus-serial');

const regCount = {
	readInt16: 1,
	readUInt16: 1, 
	readInt32: 2, 
	readUInt32: 2,
	readFloat: 2,
	readDouble: 4
}

// opts = {ip: 168.0.45.12, port: 112, device_id: 165, timeout: 3}
// address = {func: readCoils, register: 3, type: readUInt16, order: LE}
exports.getValues = function(opts, address_list, callback) {
	let client = new ModbusRTU();
	client.connectTCP(opts.ip, {port: opts.port}, function () {
		client.setID(opts.device_id);

		let timer = setTimeout(onEnd, opts.timeout * 1000 || 3000);

		let res = new Array(address_list.length);

		function onEnd() {
			clearTimeout(timer);
			timer = 0;
			client.close();

			for (let i = 0; i < address_list.length; i++)
				res[i] = !!res[i] ? res[i] : {value: 'Timeout', isError: true};

			callback(null, res);		  
		}
	
		function getValue(i) {
			if (!timer)
				return;

			if (i == address_list.length) 
				return onEnd();

			let address = address_list[i]; 
			if (!client[address.func] || !!isNaN(address.register) || address.register < 1) {
				res[i] = {
					value: 'BAD_PARAMS', 
					isError: true
				};

				getValue(i +1);
			}

			client[address.func](address.register - 1, regCount[address.type] || 1, function(err, data) {
				if (i == 0 && !!err && err.message == 'Port Not Open') {
					clearTimeout(timer);
					client.close();
					return callback(err);
				}

				res[i] = {
					value: err ? (err.message || err): data.buffer[address.type + address.order] ? data.buffer[address.type + address.order]() : data.buffer.readInt8(), 
					isError: !!err
				};

				getValue(i + 1);
			});
		}
		
		getValue(0);	
	});
}

// opts = {ip: 123.45.56.78, port: 123, device_id: 161, timeout: 3}
// actions = {func: writeFC16, register: 3, value: [10, 23]}
/*
	Func table
	writeFC5  - Force Single Coil. Param must be 0xFF00 (on) or 0x0000 (off).
	writeFC6  - Preset Single Register. Param is a 16-bit word.
	writeFC15 - Force Multiple Coils. Param is array.
	writeFC16 - Preset Multiple Registers. Param is array.
*/    
exports.doAction = function(opts, action, callback) {
	let client = new ModbusRTU();

	client.connectTCP(opts.ip, {port: opts.port}, function () {
		client.setID();
		client.setTimeout(opts.timeout * 1000 || 3000);

		if (!client[action.func] || isNaN(action.register)) {
			client.close();
			return callback('BAD_ADDRESS: ' + JSON.stringify(action));
		}

		try {	
			client[action.func](opts.device_id, action.register - 1, action.value, function (err, data) {
				client.close();
				callback(err && err.message || '');
			})
		} catch (err) {
			console.error('Request: ', opts, action);
			console.error(err);
			callback(err.message);
		}
	});			
}