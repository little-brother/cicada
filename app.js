'use strict'
const http = require('http');
const url = require('url');
const fs = require('fs');
const qs = require('querystring');
const async = require('async');

if (!fs.existsSync('./config.json'))
	fs.writeFileSync('./config.json', '{}', {flag: 'ax'});
const config = require('./config.json');

const Alert = require('./models/alert'); 
const Check = require('./models/check'); 
const Device = require('./models/device');
const Diagram = require('./models/diagram'); 

const stats = require('./modules/stats');
const network = require('./modules/network');

const Http = require('./modules/http');
const Session = require('./modules/session');

let protocols;

function auth(req, res) {
	let pwd_edit = config.access && config.access.edit || '';
	let pwd_view = config.access && config.access.view || '';

	let cookies = req.headers.cookie && req.parseCookies(req.headers.cookie);

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

	req.session = cookies && cookies.sid ? Session.get(cookies.sid) : null;

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

	if (req.session && req.session.access == 'view' && (req.method != 'GET' || /device\/([\d]+)$/g.test(req.url))) {
		res.send(401, 'Access denied');
		return false;
	}

	return true;
}

let server = http.createServer();
server.on('request', function (req, res) {
	req.parseBody = Http.parseBody;
	req.parseCookies = Http.parseCookies;
	req.parsePeriod = Http.parsePeriod;
	res.send = Http.send;
	res.json = Http.json;

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
			['id', 'name', 'description', 'tag_list', 'status', 'mac', 'ip', 'is_pinged', 'parent_id', 'force_status_to', 'alive'].forEach((prop) => obj[prop] = d[prop]);
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
			return d.getHistory(req.parsePeriod(query), query.only, query.downsample, onDone);

		if ((/^\/device\/([\d]+)\/varbind-changes$/).test(path) && req.method == 'GET') 
			return d.getChanges(req.parsePeriod(query), onDone);
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

	if (path == '/tag/lists' && req.method == 'GET') 
		return res.json(Device.getTagLists());

	if (path == '/tags' && req.method == 'GET') 
		return res.json(Device.getTags());
	
	if (path.indexOf('/tag/') == 0 && req.method == 'GET') {
		let tag = path.substring(5);
		return Device.getHistoryByTag(tag, query.tags, req.parsePeriod(query), query.downsample, onDone);
	}

	if (path.indexOf('/alert') == 0) {
		if (path == '/alert' && req.method == 'GET' && xhr)
			return Alert.getList(!isNaN(query.from) ? req.parsePeriod(query) : undefined, onDone);

		if (path == '/alert/summary' && req.method == 'GET')
			return Alert.getSummary(onDone);

		if (path == '/alert/hide' && req.method == 'POST') 
			return Alert.hide(query.ids, onDone);

		if (/alert\/([\d]*)$/g.test(path) && req.method == 'DELETE') {
			let id = parseInt(path.substring(7));
			return Alert.delete(id, onDone);
		}

		if (/alert\/([\d]*)\/hide/g.test(path) && req.method == 'POST') {
			let id = parseInt(path.substring(7));
			return Alert.hide(id, onDone);
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

	if (path == '/ping' && req.method == 'GET')
		return network.ping(query.ip, function (err, latency) {
			res.send(200, !err && !isNaN(latency) ? 1 : 0);
		});	

	if (path == '/scan' && req.method == 'GET') 
		return network.scan(query.range, Device.getIpList(), onDone);

	if (path == '/scan/cancel' && req.method == 'GET') {
		network.stopScan();
		return res.send(200);
	}

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
			return fs.readdir(path, (err, files) => (err) ? res.send(500, err.message) : res.json(files.filter((f) => f != '.gitignore')));

		if (stat.isFile())
			return fs.readFile(path, (err, data) => (err) ?  res.send(500, err.message) : res.send(200, data, path.split('.').pop()));

		res.send(500, `Error getting the path: ${path}`);
	})
});
const port = config.port || 5000;
server.listen(port, () => console.log(`Cicada running on port ${port}... at ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`));	

// Update checks, init cache and run polling
async.series([Check.update, Device.cache, Diagram.cache, Alert.cacheAnomalies], function (err) {
	if (err) {
		console.error(__filename, err.message);
		process.exit(1);
		return;
	}

	// Run services
	fs.readdirSync('./services').forEach((file) => require('./services/' + file)(config));

	network.setCommands(config['network-commands'] || {});
	Device.getList().forEach((device) => device.polling(1000 + Math.random() * 3000));
});