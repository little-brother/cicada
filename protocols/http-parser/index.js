'use strict'
const util = require('util');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
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

let https_agent = new https.Agent({maxCachedSessions: 0});

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
		method: 'GET',
		headers: {}
	};
	
	if (opts.user || opts.password)
		options.headers.Authorization = 'Basic ' + new Buffer([opts.user, opts.password].join(':')).toString('base64');

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
	let now = new Date().getTime();

	let responses = {};
	function onDone() {
		let res = address_list.map(function(address) {
			let selector = address.selector;
			let response = responses[address.url] || {};
			
			if (response.error)  
				return {
					value: response.error.message || options.headers.Authorization && 'Invalid password' || 'It seems the site does not support the selected protocol', 
					isError: true
				};

			if (!selector)
				return {value: response.text, isError: false};

			if (selector == '@time' || selector == '@code' || selector == '@size' || selector == '@expires') 
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

					if (value instanceof Object) 
						value = util.format(value);
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
		if (request.processed)
			return;

		request.processed = true;
		options.port = request.port;
		options.path = request.path;
		options.headers.Accept = mimes[request.type] + ',*/*';
		if (request.protocol == 'https')
			options.agent = https_agent;

		timer = process.hrtime(timer);
		let client = (request.protocol == 'https') ? https : http;
		let req = client.get(options, function (response) {
			let expires = 'N/A';				
			if (request.protocol == 'https') {
				let valid_to = response.connection.getPeerCertificate && response.connection.getPeerCertificate().valid_to;
				expires = Math.round((new Date(valid_to).getTime() - now) / (24 * 60 * 60 * 1000));
			}

			let data = [];
			let error;
			let size = 0;

			let src = response;						
			if (response.headers['content-encoding'] && response.headers['content-encoding'].toLowerCase().indexOf('gzip') != -1) {
		        src = zlib.createGunzip();            
		        response.pipe(src);
			}

		    src.on('data', function (chunk) {
				data.push(chunk.toString('utf-8'))
				size += Buffer.byteLength(chunk, 'utf-8'); 
			});

			src.on('error', (err) => error = err);

			src.on('end', function() {	
				timer = process.hrtime(timer);
				if (!error && response.statusCode != 200)
					error = new Error(data);

				responses[request.url] = (error) ? {
					error
				} : {
					text: data.join(''), 
					size: (response.headers || {})['content-length'] || size,
					code: response.statusCode,
					time: timer[1],
					expires 
				};

				getValue(i + 1);
			});
		});

		req.on('error', function (err) {
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