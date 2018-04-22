'use strict'
const http = require('http');
const https = require('https');
const parser = require('./fast-xml-parser');

const xmlOptions = {
	mergeCDATA: false,	// extract cdata and merge with text nodes
	grokAttr: true,		// convert truthy attributes to boolean, etc
	grokText: true,		// convert truthy text/attr to boolean, etc
	normalize: true,	// collapse multiple spaces to single space
	xmlns: false, 		// include namespaces as attributes in output
	namespaceKey: '_ns', 	// tag name for namespace objects
	textKey: '_text', 	// tag name for text nodes
	valueKey: '_value', 	// tag name for attribute values
	attrKey: '_attr', 	// tag for attr groups
	cdataKey: '_cdata',	// tag for cdata nodes (ignored if mergeCDATA is true)
	attrsAsObject: true, 	// if false, key is used as prefix to name, set prefix to '' to merge children and attrs.
	stripAttrPrefix: true, 	// remove namespace prefixes from attributes
	stripElemPrefix: true, 	// for elements of same name in diff namespaces, you can enable namespaces and access the nskey property
	childrenAsArray: true 	// force children into arrays
}

const mimes = {
	json: 'application/json', 
	xml: 'application/xml', 
	text: 'text/plain'
}

// opts = {ip: 127.0.0.1}
// address = {path: /get/user/15, type: html, selector: div[id=sidebar]} or
// address = {path: [123]/get/user/15, ...} - http request on port 123
// address = {path: [https]/get/user/15, ...} - https request on port 443
// address = {path: [https:445]/get/user/15, ...} - https request on port 445
exports.getValues = function (opts, address_list, callback) {
	let res = [];

	let options = {
		hostname: opts.hostname || opts.ip,
		port: 80,
		method: 'GET'
	};
	
	if (opts.user)
		options.auth = [opts.user, opts.password].join(':');

	let urls = {};
	let request_list = [];
	address_list.forEach(function (address, i) {
		if (!address.path) 
			address.path = '';

		let hints = (address.path.match(/\[(.*?)\]/) || ['', ''])[1].split(':');

		let protocol = hints[0] == 'https' ? 'https' : 'http';
		let port = parseInt(hints[1]) || parseInt(hints[0]) || protocol == 'https' && 443 || 80;
		let path = address.path.replace(/.*\[.*\]/, '');
		let type = address.type;
		
		address.url = protocol + '://' + opts.ip + ':' + port + path;
			
		if (urls[address.url])
			return;

		urls[address.url] = true;
		request_list.push({url: address.url, protocol, port, path, type});
	})


	let timer = process.hrtime();

	let responses = {};
	function onDone() {
		let res = address_list.map(function(address) {
			let selector = address.selector;
			let response = responses[address.url] || {};
			
			if (response.error)  
				return {value: response.error.message, isError: true};

			if (!selector)
				return {value: response.text, isError: false};

			if (selector == '@time' || selector == '@code' || selector == '@size') 
				return {value: response[selector.substring(1)], isError: false};

			let value, error;

			if (address.type == 'text') {
				try {
					let re = new RegExp(selector);
					value = ((response.text + '').match(re) || ['', ''])[1];
				} catch (err) {
					error =  err;
				}
			}

			if (address.type == 'json' || address.type == 'xml') {
				try {
					if (!response.object) 
						response.object = (address.type == 'json') ? JSON.parse(response.text) : parser.parse(response.text);
	
					value = eval('response.object' + (selector[0] != '[' ? '.' : '') + selector);
				} catch(err) {
					error = err;
				}
			}

			return {value: error && error.message || value, isError: !!error};
		});

		callback(null, res);
	}

	function getValue(i) {
		if (i == request_list.length)
			return onDone();

		let request = request_list[i];
		options.port = request.port;
		options.path = request.path;
		options.headers ={Accept: mimes[request.type] + ',*/*'};

		timer = process.hrtime(timer);
		let client = (request.protocol == 'https') ? https : http;
		client.get(options, function (response) {
			let data = '';
			let size = 0;
			let error;

			response.on('error', (err) => error = err);
			response.on('data', function (d) {
				data += d;
				size += Buffer.byteLength(d, 'utf-8');
			});

			response.on('end', function() {	
				timer = process.hrtime(timer);
				if (!error && response.statusCode != 200)
					error = new Error(data);

				responses[request.url] = (error) ? {
					error
				} : {
					text: data, 
					size: (response.headers || {})['content-length'] || size,
					code: response.statusCode,
					time: timer[1] 
				};

				getValue(i + 1);
			});
		}).on('error', function (err) {
			responses[request.url] = {error: err};
			getValue(i + 1);
		});
	}

	getValue(0);	
}

// ???
exports.doAction = function(opts, action, callback) {
	callback(null);
}