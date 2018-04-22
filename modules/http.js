'use strict'
const qs = require('querystring');
const zlib = require('zlib');

function parseBody(callback) {
	let body = '';
	this.on('data', (data) => body += data);
	this.on('end', () => callback(qs.parse(body)))
}

// req.headers.cookie
function parseCookies(cookies) {
    return cookies && cookies.split(';').reduce(function(res, cookie) {
        var pair = cookie.split('=');
        res[pair.shift().trim()] = decodeURI(pair.join('='));
		return res;
    }, {}) || {};
}

function parsePeriod(query) {
	let time = new Date().getTime();
	let q = {from: parseInt(query.from), to: parseInt(query.to)};

	if (!q.from)
		return [time - 1000 * 3600, time];

	if (!q.to)
		return [q.from, q.from + 1000 * 3600 * 24];

	return [q.from, q.to];
}

const mimes = {'ico': 'image/x-icon', 'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'json': 'application/json'};
function send(code, data, mime) {
	this.statusCode = code;
	this.setHeader('Content-type', mimes[mime] || 'text/plain');

	if (mime == 'json') {
		this.setHeader('Content-Encoding', 'gzip');
		zlib.gzip(data, (_, zipped) => this.end(zipped))
		return;
	}

	this.end(!(typeof(data) == 'string' || data instanceof Buffer || data == undefined) ? data + '' : (typeof(data) == 'boolean') ? +data : data);
}

function json (obj) {
	this.send(200, JSON.stringify(obj), 'json')
}

module.exports = {parseBody, parsePeriod,  parseCookies, send, json};