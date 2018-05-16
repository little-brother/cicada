'use strict'
const http = require('http');
const fs = require('fs');
const async = require('async');

if (!fs.existsSync('./config.json'))
	fs.writeFileSync('./config.json', '{}', {flag: 'ax'});
const config = require('./config.json');

const Alert = require('./models/alert'); 
const Check = require('./models/check'); 
const Device = require('./models/device');
const Diagram = require('./models/diagram');
const Condition = require('./models/condition');
 
const stats = require('./modules/stats');
const network = require('./modules/network');

const Http = require('./modules/http');
const Session = require('./modules/session');

let protocols;

function auth(req, res) {
	let pwd_edit = config.access && config.access.edit || '';
	let pwd_view = config.access && config.access.view || '';

	// Basic auth
	if (req.headers['authorization']) {
		let password = new Buffer(req.headers.authorization.split(' ')[1], 'base64').toString().split(':')[1] || '';

		let access = password == pwd_edit ? 'edit' : password == pwd_view ? 'view' : null;
		if (!access) {
			res.send(401, 'Incorrect password');
			return false;
		}

		if (access == 'view' && (req.method != 'GET' || /device\/([\d]+)$/g.test(req.url))) {
			res.send(401, 'Access denied');
			return false;
		}
			
		return true;
	}

	if (req.url == '/login' && req.method == 'GET')
		res.setHeader('Set-Cookie', [`sid=; expired; httpOnly`, `access=;expired`]);


	if (req.url == '/login' && req.method == 'POST') {
		let access = req.body.password == pwd_edit ? 'edit' : req.body.password == pwd_view ? 'view' : null;
		if (!access)
			return res.send(401, 'Incorrect password');
	
		req.session = new Session({access});
		res.setHeader('Set-Cookie', [`sid=${req.session.id}; httpOnly`, `access=${access}`]);
		res.end();
		return false;
	}
	
	req.session = req.cookies.sid ? Session.get(req.cookies.sid) : null;

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


	// If read-only then block full device info to protect passwords
	if (req.session && req.session.access == 'view' && (req.method != 'GET' || /device\/([\d]+)$/g.test(req.url))) {
		res.send(401, 'Access denied');
		return false;
	}

	return true;
}

let server = http.createServer();
server.on('request', function (req, res) {
	res.send = Http.send;
	res.json = Http.json;

	Http.parse(req, () => onRequest(req, res));
});

function onRequest(req, res) {
	let onDone = (err, data) => err ? res.send(500, err.message) : data instanceof Object ? res.json(data) : res.send(200, data);

	if (!auth(req, res))	
		return;

	if (!req.xhr && (/device\/([\d]+)$/g.test(req.path) || /diagram\/([\d]+)$/g.test(req.path) || req.path == '/alert')) {
		let header = res.getHeader('Set-Cookie') || [];
		header.push(`redirect=${req.path};expired`);
		res.setHeader('Set-Cookie', header);
		req.path = '/index.html';
	}

	if (req.path == '/device' && req.method == 'GET') {
		return res.json(Device.getList().map(function (d) {
			let obj = {};
			['id', 'name', 'description', 'tag_list', 'status', 'mac', 'ip', 'is_pinged', 'parent_id', 'force_status_to', 'alive'].forEach((prop) => obj[prop] = d[prop]);
			return obj;	
		}));
	}

	if (req.path == '/device' && req.method == 'POST') {
		let id = req.body.id;
		let d = id ? Device.get(id, true) : new Device();
		if (!d)
			return res.send(404, 'Bad device id: ' + id);

		d.setAttributes(req.body);
		d.save(onDone);
		return;
	}

	if (/device\/([\d]+)/g.test(req.path) && req.xhr) {
		let id = parseInt(req.path.substring(8));

		let d = Device.get(id);
		if (!d)
			return res.send(404, 'Bad device id: ' + id);

		if (req.path == `/device/${id}` && req.method == 'GET')
			return res.json(d);	

		if (req.path == `/device/${id}` && req.method == 'DELETE')
			return d.delete(onDone);

		if (/device\/([\d]+)\/varbind-list$/g.test(req.path) && req.method == 'GET') 
			return res.json(d.varbind_list.filter((v) => !v.is_temporary).map((v) => new Object({id: v.id, name: v.name, value: v.value, value_type: v.value_type, is_history: v.is_history, status: v.status || 0})));

		if ((/^\/device\/([\d]+)\/varbind-history$/).test(req.path) && req.method == 'GET') 
			return d.getHistory({downsample: req.query.downsample, period: req.period, summary: req.query.summary, only_varbind_id: req.query.only}, onDone);

		if ((/^\/device\/([\d]+)\/varbind-changes$/).test(req.path) && req.method == 'GET') 
			return d.getChanges(req.period, onDone);
	}

	if (req.path == '/diagram' && req.method == 'GET') 
		return res.json(Diagram.getList().map((d) => new Object({id: d.id, name: d.name, status: d.status})));

	if (req.path == '/diagram' && req.method == 'POST') {
		let id = req.body.id;
		let d = id ? Diagram.get(id, true) : new Diagram();
		if (!d)
			return res.send(404, 'Bad diagram id: ' + id);

		d.setAttributes(req.body);
		d.save(onDone);
		return;
	}

	if (/diagram\/([\d]+)/g.test(req.path) && req.xhr) {
		let id = parseInt(req.path.substring(9));

		let d = Diagram.get(id);
		if (!d)
			return res.send(404, 'Bad diagram id: ' + id);

		if (req.path == `/diagram/${id}` && req.method == 'GET') 	
			return res.json({id: d.id, name: d.name, status: d.status, element_list: d.element_list});	
		

		if (req.path == `/diagram/${id}` && req.method == 'DELETE')
			return d.delete(onDone);
	}

	if (req.path == '/tag/lists' && req.method == 'GET') 
		return res.json(Device.getTagLists());

	if (req.path == '/tags' && req.method == 'GET') 
		return res.json(Device.getTags());
	
	if (req.path.indexOf('/tag/') == 0 && req.method == 'GET') {
		let tag = req.path.substring(5);
		return Device.getHistoryByTag(tag, req.query.tags, {period: req.period, downsample: req.query.downsample, summary: req.query.summary}, onDone);
	}

	if (req.path.indexOf('/alert') == 0) {
		if (req.path == '/alert' && req.method == 'GET' && req.xhr)
			return Alert.getList(!isNaN(req.query.from) ? req.period : undefined, onDone);

		if (req.path == '/alert/summary' && req.method == 'GET')
			return Alert.getSummary(onDone);

		if (req.path == '/alert/hide' && req.method == 'POST') 
			return Alert.hide(req.query.ids, onDone);

		if (/alert\/([\d]*)$/g.test(req.path) && req.method == 'DELETE') {
			let id = parseInt(req.path.substring(7));
			return Alert.delete(id, onDone);
		}

		if (/alert\/([\d]*)\/hide/g.test(req.path) && req.method == 'POST') {
			let id = parseInt(req.path.substring(7));
			return Alert.hide(id, onDone);
		}
	}

	if (req.path.indexOf('/condition') == 0) {
		if (req.path == '/condition' && req.method == 'GET')
			return res.json(Condition.getList().map((c) => new Object({id: c.id, name: c.name})));

		if (/condition\/([\d]*)$/g.test(req.path) && req.method == 'GET') {
			let id = parseInt(req.path.substring(11));
			let condition = Condition.get(id);
			return !condition ?
				res.send(404, 'Bad condition id: ' + id) :
				res.json(condition);
		}

		if (req.path == '/condition' && req.method == 'POST') {
			let id = req.body.id;
			let condition = id ? Condition.get(id, true) : new Condition();
			if (!condition)
				return res.send(404, 'Bad condition id: ' + id);

			condition.setAttributes(req.body);
			condition.save(onDone);
			return;
		}
	}

	if (req.path == '/check') {
		if (req.method == 'GET')
			return Check.getList(onDone);

		if (req.method == 'POST')
			return Check.saveList(req.body && body.check_list, onDone);
	}

	if (req.path.indexOf('/template') == 0) {
		if (req.path == '/template' && req.method == 'GET') {
			fs.readdir('./templates', function (err, files) {
				if (err)
					return res.send(500, err.message);

				let templates = files.filter((file) => file.substr(-5) == '.json').map((file) => file.slice(0, -5));
				res.json(templates);
			});
			return;	
		}

		let template = './templates/' + req.path.substring(10) + '.json';
		if (req.method == 'GET') 
			return fs.readFile(template, {encoding: 'utf-8'}, onDone);

		if (req.method == 'POST') 
			return fs.writeFile(template, req.body.template, {encoding: 'utf-8'}, onDone);

		if (req.method == 'DELETE')
			return fs.unlink(template, onDone);
	}

	if (req.path == '/ping' && req.method == 'GET')
		return network.ping(req.query.ip, function (err, latency) {
			res.send(200, !err && !isNaN(latency) ? 1 : 0);
		});	

	if (req.path == '/scan' && req.method == 'GET') 
		return network.scan(req.query.range, Device.getIpList(), onDone);

	if (req.path == '/scan/cancel' && req.method == 'GET') {
		network.stopScan();
		return res.send(200);
	}

	if (req.path == '/protocols' && req.method == 'GET') {
		if (!protocols) {
			try {
				protocols = {};			
				fs.readdirSync('./protocols').forEach(function (dir) {
					protocols[dir] = {
						html: fs.readFileSync(`./protocols/${dir}/index.html`, {encoding: 'utf-8'}).toString(),
						discovery: []
					}	
				});
				fs.readdirSync('./discovery').forEach(function (file) {
					let info = file.split('.');
					if (protocols[info[0]])
						protocols[info[0]].discovery.push(info[1]);
				});
			} catch (err) {
				protocols = null;
				console.error(__filename, err);
				return res.send(500, err.message); 
			}
		}

		return res.json(protocols);
	}

	if ((req.path == '/value' || req.path == '/discovery') && req.method == 'GET') {
		let opts;
		try {
			opts = JSON.parse(req.query.json_opts);
		} catch (err) { 
			opts = err;
		}

		if (opts instanceof Error)
			return res.send(500, opts.message);

		return (req.path == '/value') ? 
			Device.getValue(opts, (err, val) => res.send(200, (err) ? err.message : val)) :
			Device.discovery(opts, onDone);
	}

	if (req.path == '/upload' && req.method == 'POST') {		
		var data = [];
		req.on('data', (chunk) => data.push(chunk));
		req.on('end', function () {
			var buffer = Buffer.concat(data);
			
			var from = buffer.indexOf('\r\n\r\n') + 4;
			var to = buffer.lastIndexOf('\r\n', buffer.length - 4);

			var header = buffer.slice(0, from).toString();
			var filename = (header.match(/\bfilename="(.*?)"/i) || {})[1];
			if (!filename)
				return res.send(500, 'Filename is required');

			fs.writeFile('./public/images/' + filename, buffer.slice(from, to), (err) => (err) ? res.send(500, err.message) : res.send(200, filename));
		});
		return;
	}

	if (req.path == '/stats') 
		return stats((err, html) => (err) ? res.send(500, err.message) : res.send(200, html, 'html'));

	// Serve static
	if (req.path == '/')
		req.path = '/index.html';

	if (req.path == '/login')	
		req.path = '/login.html';

	req.path = (req.path.indexOf('/protocols') == -1 || req.path.indexOf('/help.html') == -1) ? './public/' + req.path : '.' + req.path ;
	req.path = decodeURI(req.path);

	fs.stat(req.path, function (err, stat) {
		if (err)
			return res.send(500, err.message);

		if (stat.isDirectory()) 
			return fs.readdir(req.path, (err, files) => (err) ? res.send(500, err.message) : res.json(files.filter((f) => f != '.gitignore')));

		if (stat.isFile())
			return fs.readFile(req.path, (err, data) => (err) ?  res.send(500, err.message) : res.send(200, data, req.path.split('.').pop()));

		res.send(500, `Error getting the path: ${req.path}`);
	})
}

const port = config.port || 5000;
server.listen(port, () => console.log(`${new Date().toLocaleString([], {year: 'numeric', day: '2-digit', month: '2-digit',  hour: '2-digit', minute:'2-digit'})} Cicada running on port ${port}...`));	

// Update checks, init cache and run polling
async.series([Check.update, Condition.purge, Device.cache, Diagram.cache, Alert.cacheAnomalies], function (err) {
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