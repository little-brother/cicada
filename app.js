'use strict'
const http = require('http');
const url = require('url');
const fs = require('fs');
const qs = require('querystring');
const exec = require('child_process').exec;
const WebSocket = require('ws');

const Device = require('./modules/device'); 
const nmap = require('./modules/nmap'); 
const config = require('./config.json');

let scan_processes = [];

let server = http.createServer();
server.on('request', function (req, res) {
	function send(code, data, mime) {
		const mimes = {'ico': 'image/x-icon', 'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'json': 'application/json'};
		res.setHeader('Content-type', mimes[mime] || 'text/plain');
		res.statusCode = code;
		if (!(typeof(data) == 'string' || data instanceof Buffer))
			data = data + '';
		res.end(data);
	}

	function json(obj) {
		send(200, JSON.stringify(obj), 'json')
	}

	function parseBody(callback) {
        let body = '';
        req.on('data', (data) => body += data);
        req.on('end', () => callback(qs.parse(body)))
    }

	function parsePeriod(query) {
		let time = new Date().getTime();
		let q = {from: parseInt(query.from), to: parseInt(query.to)};
		return (!q.from) ? [time - 1000 * 3600, time] : [q.from, (q.to || q.from) + 1000 * 3600 * 24];	
	}
	
	let xhr = req.headers['x-requested-with'] == 'XMLHttpRequest';
	let path = url.parse(req.url).pathname;
	let query = qs.parse(req.url.replace(/^.*\?/, ''));
	
	let host = req.headers.host || req.headers.hostname;
	let port = server.address().port;	
	if (host != `localhost:${port}` && host != `127.0.0.1:${port}` && req.method != 'GET')
		return send(401, 'Remote access is read-only mode.');

	if (path == '/device' && req.method == 'GET') {
		return json(Device.getList().map(function (d) {
			let obj = {};
			['id', 'name', 'description', 'tag_list', 'status', 'mac', 'ip', 'is_pinged', 'parent_id', 'force_status_to'].forEach((prop) => obj[prop] = d[prop]);
			return obj;	
		}));
	}

	if (path == '/device' && req.method == 'POST') {
		parseBody(function(body) {
			let d = (body.id) ? Device.get(body.id, true) : new Device();
			if (!d)
				return send(404, 'Bad device id: ' + id);

			d.setAttributes(body);
			d.save(function(err, id) {
				if (err)
					return send(500, err.message);
			
				send(200, id);
			})
		})
		return;
	}

	if (/device\/([\d]*)/g.test(path)) {
		let id = parseInt(path.substring(8));

		let d = Device.get(id);
		if (!d)
			return send(404, 'Bad device id: ' + id);

		// If read-only then remove protocol_params
		if (/device\/([\d]*)$/g.test(path) && req.method == 'GET')
			return json(d);	

		if (/device\/([\d]*)$/g.test(path) && req.method == 'DELETE')
			return d.delete((err) => send(err ? 500: 200));

		if (/device\/([\d]*)\/varbind-list$/g.test(path) && req.method == 'GET')
			return json(d.varbind_list.map((v) => new Object({id: v.id, name: v.name, value: v.value, value_type: v.value_type})));
		
		if ((/^\/device\/([\d]*)\/varbind-history$/).test(path) && req.method == 'GET') 
			return d.getHistory(parsePeriod(query) , (err, res) => (err) ? send(500, err.message) : json(res));
	}

	if (path == '/tag' && req.method == 'GET') 
		return json(Device.getTagList());
	
	if (path.indexOf('/tag/') == 0 && req.method == 'GET') {
		let tag = path.substring(5);
		Device.getHistoryByTag(tag, query.tags, parsePeriod(query), function(err, res) {
			if (err)
				return send(500, err.message);

			json(res);
		})
		return;
	}

	if (path.indexOf('/template/') == 0 && req.method == 'POST') {
		parseBody(function (body) {
			fs.readFile('./public/templates.json', {encoding: 'utf-8'}, function(err, data) {
				if (err && err.code != 'ENOENT')
					return send(500, err.message);
	
				let templates, template, error;
				try {
					err = null;
					templates = JSON.parse(data || '{}');
					template = JSON.parse(body.varbind_list);
				} catch (err) {
					return send(500, err.message);
				}

				templates[qs.unescape(path.substring(10))] = template;
				fs.writeFile('./public/templates.json', JSON.stringify(templates, 1, '\t'), {encoding: 'utf-8'}, (err) => (err) ? send(500, err.message) : send(200, 'OK'));
			})
		})
		return;
	}

	if (path.indexOf('/template/') == 0 && req.method == 'DELETE') {
		fs.readFile('./public/templates.json', {encoding: 'utf-8'}, function(err, data) {
			if (err)
				return send(500, err.message);
			
			let templates, template;
			try {
				templates = JSON.parse(data || '{}');
				template = qs.unescape(path.substring(10));
			} catch (err) {
				return send(500, err.message);
			}

			delete templates[template];
			fs.writeFile('./public/templates.json', JSON.stringify(templates, 1, '\t'), {encoding: 'utf-8'}, (err) => (err) ? send(500, err.message) : send(200, 'OK'));
		})
		return;
	}

	if (path == '/scan' && req.method == 'GET') {
		let proc = nmap.ping(query.range, Device.getIpList().join(','), function(err, result) {
			if (err)
				return send(500, err.message);

			json(result);
		});
		scan_processes.push(proc);	
		return;	
	}

	if (path == '/scan/cancel' && req.method == 'GET' || scan_processes.length > 0) {
		scan_processes.forEach(function (proc) {
			try {
				proc.stdin.pause(); 
				proc.kill();
			} catch (err) {
				console.error(err);
			}
		});
		scan_processes = [];

		if (path == '/scan/cancel' && req.method == 'GET')
			return send(200, 'OK');
	}

	if (path == '/value' && req.method == 'GET') {
		let opts;
		try {
			opts = JSON.parse(query.json_opts);
		} catch (err) { 
			opts = err;
		}

		if (opts instanceof Error)
			return send(500, opts.message);

		return Device.getValue(opts, (err, res) => send(200, (err) ? err.message : res));
	}

	// Serve static
	if (path == '/')
		path = '/index.html';

	fs.readFile('./public/' + path, function(err, data) {
		if (err) 
			return (err.code === 'ENOENT') ? send(404, 'Page not found.') : send(500, `Error getting the file: ${err}.`);

		send(200, data, path.split('.').pop());
	});
});
const port = config.port || 5000;
server.listen(port, () => console.log(`Chupacabra running on port ${port}...`));		

// Init cache and run polling
Device.cache(function (err) {
	if (err) {
		console.error(err.message);
		process.exit(1);
		return;
	}
	
	Device.getList().forEach((device) => device.polling());
});

// Web notifier by socket 
let	wss = new WebSocket.Server({ 
	port: parseInt(config.port || 5000) + 1,
	clientTracking: true
});

wss.on('connection', function connection(ws) {
	ws.on('message', function (msg) { 
		ws.device_id = (/device\/([\d]*)/g).test(msg) ? parseInt(msg.substring(8)) : 0;
	});
});

setInterval(function () {
	if (!wss || !wss.clients)
		return;
	// send ping to keep connection alive 
	wss.clients.forEach(function(client) {
		if (client.readyState == WebSocket.OPEN)
			client.ping('ping');
	})
}, 10000);	

Device.events.on('values-changed', function (device, time) {
	if (!wss || !wss.clients)
		return;

	wss.clients.forEach(function(client) {
		if (client.device_id != device.id)
			return;

		try {
			client.send(JSON.stringify({
				event: 'values-changed',
				id: device.id,
				values: device.varbind_list.map((v) => new Object({id: v.id, value: v.value, value_type: v.value_type})),
				time: time
			}));
		} catch(err) { }
	});
})

Device.events.on('status-updated', function(device) {
	if (!wss || !wss.clients)
		return;

	wss.clients.forEach(function(client) {
		try {
			client.send(JSON.stringify({
				event: 'status-updated',
				id: device.id,
				status: device.status	
			}));
		} catch(err) { }
	});
});

Device.events.on('status-changed', function(device, reason) {
	function run(event) {
		if (!config[event] || !config[event].command)
			return;

		try {
			exec(eval(`\`${config[event].command}\``), config[event].options || {}, (err, stdout, stderr) => (err) ? console.error(err) : null);
		} catch (err) {
			console.error(err);
		}
	}

	run('on-status-change');

	let event = (device.status == 2) ? 'on-warning' : (device.status == 3) ? 'on-critical' : null;
	if (!event)
		return;

	if (!device.parent_id)
		return run(event);

	let parent = Device.get(device.parent_id);
	if (parent && parent.ip)
		return nmap.ping(parent.ip, null, (err, res) => (err || res && res[0] && res[0].alive) ? run(event) : null);

	d.updateParent(function(err, parent) {
		if (err) {
			console.error(err);
			return run(event);
		}

		if (parent)
			return nmap.ping(parent.ip, null, (err, res) => (err || res && res[0] && res[0].alive) ? run(event) : null);
	})
})

// nmap ping by timer
function runPing (delay) {
	if (delay)
		return setTimeout(runPing, config['ping-period'] * 1000 || 60000);

	let ips = Device.getIpList(true).join(' ');
	if (!ips) 
		return runPing(true);

	nmap.ping(ips, null, function(err, result) {
		if (err) {
			console.error(err.message);
			runPing(true);
			return;
		}

		Device.updateLatencies(result, function (err) {
			if (err)
				console.error(err.message);
			
			runPing(true);
		});
	})
}
runPing(true);

// Auto scan
function runAutoScan(delay) {
	let params = config['auto-scan'];
	if (!params || !params['on-detect'] || !params.range)
		return;

	if (delay)
		return setTimeout(runAutoScan, params.period * 1000 || 30000);

	nmap.ping(params.range, Device.getIpList().join(','), function(err, result) {
		if (err)
			console.error('Auto-scan: ' + err.message);

		result.forEach(function(r) {
			let ip = r.ip;
			let mac = r.mac;
			let description = r.description;
			try {
				exec(eval(`\`${params['on-detect'].command}\``), params['on-detect'].options || {}, (err, stdout, stderr) => (err) ? console.error(err.message) : null);
			} catch (err) {
				console.error(err);
			}
		});

		runAutoScan(true);
	})	
}
runAutoScan(true);

exec('wmic /?', (err) => (err) ? console.error('wmic not found') : null);
exec('nmap /?', (err) => (err) ? console.error('nmap not found') : null);