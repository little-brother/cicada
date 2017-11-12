'use strict'
const http = require('http');
const url = require('url');
const fs = require('fs');
const qs = require('querystring');
const crypto = require('crypto');
const async = require('async');

if (!fs.existsSync('./config.json'))
	fs.writeFileSync('./config.json', '{}', {flag: 'ax'});
const config = require('./config.json');

const Alert = require('./models/alert'); 
const Check = require('./models/check'); 
const Device = require('./models/device'); 
const Diagram = require('./models/diagram'); 

const stats = require('./modules/stats');
const nmap = require('./modules/nmap');

let protocols;
let scan_processes = [];

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

function send(code, data, mime) {
	const mimes = {'ico': 'image/x-icon', 'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'json': 'application/json'};
	this.setHeader('Content-type', mimes[mime] || 'text/plain');
	this.statusCode = code;	
	this.end(!(typeof(data) == 'string' || data instanceof Buffer || data == undefined) ? data + '' : (typeof(data) == 'boolean') ? +data : data);
}

function json (obj) {
	this.send(200, JSON.stringify(obj), 'json')
}

let sessions = {};
function Session(props) {
	Object.assign(this, props);
	let sid = crypto.randomBytes(32).toString('hex');
	this.id = sid;
	sessions[sid] = this;
}

function auth(req, res) {
	let pwd_edit = config.access && config.access.edit || '';
	let pwd_view = config.access && config.access.view || '';

	let cookies = req.headers.cookie && parseCookies(req.headers.cookie);

	if (req.url == '/login' && req.method == 'GET')
		res.setHeader('Set-Cookie', [`sid=; expired; httpOnly`, `access=;expired`]);

	if (req.url == '/login' && req.method == 'POST') {
		req.parseBody(function(body) {
			let access = body.password == pwd_edit ? 'edit' : body.password == pwd_view ? 'view' : null;
			if (!access)
				return res.send(401, 'Incorrect password');
		
			req.session = new Session({access});
			res.setHeader('Set-Cookie', [`sid=${req.session.id}; httpOnly`, `access=${access}`]);
			res.end();
		})
		return false;
	}

	req.session = cookies && cookies.sid ? sessions[cookies.sid] : null;

	if (req.url != '/login' && !req.session) {		
		let access = !pwd_edit ? 'edit' : !pwd_view ? 'view' : null;

		if (access) {
			req.session = new Session({access});
			res.setHeader('Set-Cookie', [`sid=${req.session.id}; httpOnly`, `access=${access}`]);
			return true;
		}
		
		res.writeHead(302, {'Location': '/login','Content-type': 'text/html', 'Set-Cookie': [`sid=; expired; httpOnly`, `access=;expired`]});
		res.end();
		return false;
	}

	if (req.session && req.session.access == 'view' && req.method != 'GET') {
		res.send(401, 'Access denied');
		return false;
	}

	return true;
} 

let server = http.createServer();
server.on('request', function (req, res) {
	Object.assign(res, {send, json});
	req.parseBody = parseBody;

	let onDone = (err, data) => err ? res.send(500, err.message) : data instanceof Object ? res.json(data) : res.send(200, data);
	
	let xhr = req.headers['x-requested-with'] == 'XMLHttpRequest';
	let path = url.parse(req.url).pathname;
	let query = qs.parse(req.url.replace(/^.*\?/, ''));

	if (!auth(req, res))	
		return;

	if (!xhr && (/device\/([\d]+)/g.test(path) || path == '/alert'))
		path = '/index.html';

	if (path == '/device' && req.method == 'GET') {
		return res.json(Device.getList().map(function (d) {
			let obj = {};
			['id', 'name', 'description', 'tag_list', 'status', 'mac', 'ip', 'is_pinged', 'parent_id', 'force_status_to'].forEach((prop) => obj[prop] = d[prop]);
			return obj;	
		}));
	}

	if (path == '/device' && req.method == 'POST') {
		req.parseBody(function(body) {
			let d = (body.id) ? Device.get(body.id, true) : new Device();
			if (!d)
				return res.send(404, 'Bad device id: ' + body.id);

			d.setAttributes(body);
			d.save(onDone);
		})
		return;
	}

	if (/device\/([\d]+)/g.test(path) && xhr) {
		let id = parseInt(path.substring(8));

		let d = Device.get(id);
		if (!d)
			return res.send(404, 'Bad device id: ' + id);

		// If read-only then remove protocol_params to protect passwords
		if (path == `/device/${id}` && req.method == 'GET')
			return res.json(d);	

		if (path == `/device/${id}` && req.method == 'DELETE')
			return d.delete(onDone);

		if (/device\/([\d]+)\/varbind-list$/g.test(path) && req.method == 'GET')
			return res.json(d.varbind_list.filter((v) => !v.is_temporary).map((v) => new Object({id: v.id, name: v.name, value: v.value, value_type: v.value_type, status: v.status || 0})));

		if ((/^\/device\/([\d]+)\/varbind-history$/).test(path) && req.method == 'GET') 
			return d.getHistory(parsePeriod(query), query.downsample, onDone);

		if ((/^\/device\/([\d]+)\/varbind-changes$/).test(path) && req.method == 'GET') 
			return d.getChanges(parsePeriod(query), onDone);
	}

	if (path == '/diagram' && req.method == 'GET') 
		return res.json(Diagram.getList().map((d) => new Object({id: d.id, name: d.name, status: d.status})));

	if (path == '/diagram' && req.method == 'POST') {
		req.parseBody(function(body) {
			let d = (body.id) ? Diagram.get(body.id, true) : new Diagram();
			if (!d)
				return res.send(404, 'Bad diagram id: ' + body.id);

			d.setAttributes(body);
			d.save(onDone);
		})
		return;
	}

	if (/diagram\/([\d]+)/g.test(path) && xhr) {
		let id = parseInt(path.substring(9));

		let d = Diagram.get(id);
		if (!d)
			return res.send(404, 'Bad diagram id: ' + id);

		if (path == `/diagram/${id}` && req.method == 'GET') 	
			return res.json({id: d.id, name: d.name, status: d.status, element_list: d.element_list});	
		

		if (path == `/diagram/${id}` && req.method == 'DELETE')
			return d.delete(onDone);
	}

	if (path == '/tag' && req.method == 'GET') 
		return res.json(Device.getTagList());
	
	if (path.indexOf('/tag/') == 0 && req.method == 'GET') {
		let tag = path.substring(5);
		return Device.getHistoryByTag(tag, query.tags, parsePeriod(query), query.downsample, onDone);
	}

	if (path.indexOf('/alert') == 0) {
		if (path == '/alert' && req.method == 'GET' && xhr)
			return Alert.getList(!isNaN(query.from) ? parsePeriod(query) : undefined, onDone);

		if (path == '/alert/summary' && req.method == 'GET')
			return Alert.getSummary(onDone);

		if (path == '/alert/hide' && req.method == 'POST')
			return Alert.hide(null, onDone);

		if (/alert\/([\d]*)\/hide/g.test(path) && req.method == 'POST') {
			let id = parseInt(path.substring(7));
			Alert.hide(id, onDone);
			return;
		}
	}

	if (path == '/check') {
		if (req.method == 'GET')
			return Check.getList(onDone);

		if (req.method == 'POST')
			return req.parseBody((body) => Check.saveList(body && body.check_list, onDone));
	}

	if (path.indexOf('/template') == 0) {
		if (path == '/template' && req.method == 'GET') {
			fs.readdir('./templates', function (err, files) {
				if (err)
					return res.send(500, err.message);

				let templates = files.filter((file) => file.substr(-5) == '.json').map((file) => file.slice(0, -5));
				res.json(templates);
			});
			return;	
		}

		let template = './templates/' + qs.unescape(path.substring(10)) + '.json';
		if (req.method == 'GET') 
			return fs.readFile(template, {encoding: 'utf-8'}, onDone);

		if (req.method == 'POST')
			return req.parseBody((body) => fs.writeFile(template, body.varbind_list, {encoding: 'utf-8'}, onDone));

		if (req.method == 'DELETE')
			return fs.unlink(template, onDone);
	}

	if (path == '/scan' && req.method == 'GET') {
		let proc = nmap.ping(query.range, Device.getIpList().join(','), onDone);
		scan_processes.push(proc);	
		return;	
	}

	if (path == '/ping' && req.method == 'GET')
		return nmap.ping(query.ip, null, function (err, result) {
			if (err)	
				return res.send(500, err.message);
			res.send(200, result[0] && +result[0].alive || 0);
		});	

	if (path == '/protocols' && req.method == 'GET') {
		if (!protocols) {
			try {
				protocols = {};			
				fs.readdirSync('./protocols').forEach((dir) => protocols[dir] = fs.readFileSync(`./protocols/${dir}/index.html`, {encoding: 'utf-8'}).toString());
			} catch (err) {
				protocols = null;
				console.error(__filename, err);
				return res.send(500, err.message); 
			}
		}

		return res.json(protocols);
	}

	if (path == '/scan/cancel' && req.method == 'GET' || scan_processes.length > 0) {
		scan_processes.forEach(function (proc) {
			try {
				proc.stdin.pause(); 
				proc.kill();
			} catch (err) {
				console.error(__filename, err);
			}
		});
		scan_processes = [];

		if (path == '/scan/cancel' && req.method == 'GET')
			return res.send(200);
	}

	if (path == '/value' && req.method == 'GET') {
		let opts;
		try {
			opts = JSON.parse(query.json_opts);
		} catch (err) { 
			opts = err;
		}

		if (opts instanceof Error)
			return res.send(500, opts.message);

		return Device.getValue(opts, (err, val) => res.send(200, (err) ? err.message : val));
	}

	if (req.url == '/upload' && req.method == 'POST') {		
		var data = [];
		req.on('data', (chunk) => data.push(chunk));
		req.on('end', function () {
			var buffer = Buffer.concat(data);
			
			var from = buffer.indexOf('\r\n\r\n') + 4;
			var to = buffer.lastIndexOf('\r\n', buffer.length - 4);

			var header = buffer.slice(0, from).toString();
			var filename = header.match(/\bfilename="(.*?)"/i)[1];
			fs.writeFile('./public/images/' + filename, buffer.slice(from, to), (err) => (err) ? res.send(500, err.message) : res.send(200, filename));
		});
		return;
	}

	if (path == '/stats') 
		return stats((err, html) => (err) ? res.send(500, err.message) : res.send(200, html, 'html'));

	// Serve static
	if (path == '/')
		path = '/index.html';

	if (path == '/login')	
		path = '/login.html';

	path = (path.indexOf('/protocols') == -1 || path.indexOf('/help.html') == -1) ? './public/' + path : '.' + path ;
	path = decodeURI(path);

	fs.stat(path, function (err, stat) {
		if (err)
			return res.send(500, err.message);

		if (stat.isDirectory()) 
			return fs.readdir(path, (err, files) => (err) ? res.send(500, err.message) : res.json(files));

		if (stat.isFile())
			return fs.readFile(path, (err, data) => (err) ?  res.send(500, err.message) : res.send(200, data, path.split('.').pop()));

		res.send(500, `Error getting the path: ${path}.`);
	})
});
const port = config.port || 5000;
server.listen(port, () => console.log(`Cicada running on port ${port}...`));	

// Update checks, init cache and run polling
async.series([Check.update, Device.cache, Diagram.cache], function (err) {
	if (err) {
		console.error(__filename, err.message);
		process.exit(1);
		return;
	}

	// Run services
	fs.readdirSync('./services').forEach((file) => require('./services/' + file)(config));

	Device.getList().forEach((device) => device.polling(1000 + Math.random() * 3000));
});