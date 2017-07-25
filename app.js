'use strict'
const http = require('http');
const url = require('url');
const fs = require('fs');
const qs = require('querystring');
const exec = require('child_process').exec;
const WebSocket = require('ws');

const Device = require('./modules/device'); 
const Alert = require('./modules/alert'); 
const nmap = require('./modules/nmap'); 
const config = require('./config.json');

let scan_processes = [];
let alert_summary  = {warning: 0, critical: 0};

let server = http.createServer();
server.on('request', function (req, res) {
	function send(code, data, mime) {
		const mimes = {'ico': 'image/x-icon', 'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'json': 'application/json'};
		res.setHeader('Content-type', mimes[mime] || 'text/plain');
		res.statusCode = code;
		if (!(typeof(data) == 'string' || data instanceof Buffer || data == undefined))
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

	function onDone (err, data) {
		return err ? send(500, err.message) : 
			data instanceof Object ? json(data) : 
			send(200, data);
	}
	
	let xhr = req.headers['x-requested-with'] == 'XMLHttpRequest';
	let path = url.parse(req.url).pathname;
	let query = qs.parse(req.url.replace(/^.*\?/, ''));

	let access = getAccess(req.connection.remoteAddress);
	if (access == 'none' || req.method != 'GET' && access != 'edit')
		return send(401, 'Access denied');

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
			d.save(onDone);
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
			return d.delete(onDone);

		if (/device\/([\d]*)\/varbind-list$/g.test(path) && req.method == 'GET')
			return json(d.varbind_list.filter((v) => !v.is_temporary).map((v) => new Object({id: v.id, name: v.name, value: v.value, value_type: v.value_type, status: v.status || 0})));
		
		if ((/^\/device\/([\d]*)\/varbind-history$/).test(path) && req.method == 'GET') 
			return d.getHistory(parsePeriod(query), onDone);

		if ((/^\/device\/([\d]*)\/varbind-changes$/).test(path) && req.method == 'GET') 
			return d.getChanges(parsePeriod(query), onDone);
	}

	if (path == '/tag' && req.method == 'GET') 
		return json(Device.getTagList());
	
	if (path.indexOf('/tag/') == 0 && req.method == 'GET') {
		let tag = path.substring(5);
		return Device.getHistoryByTag(tag, query.tags, parsePeriod(query), onDone);
	}

	if (path.indexOf('/alert') == 0) {
		if (path == '/alert' && req.method == 'GET')
			return Alert.getList(onDone);

		if (/alert\/([\d]*)\/hide/g.test(path) && req.method == 'POST') {
			let id = parseInt(path.substring(7));
			Alert.hide(id, function (err) {
				if (err)
					return send(500, err.message);

				Alert.getSummary(function (err, res) {
					if (err) 
						return send(500, err.message); 
					
					alert_summary = res;
					let packet =  {event: 'alert-summary', warning: alert_summary.warning, critical: alert_summary.critical};
					broadcast(packet);
					 
					send(200);
				});
			})
			return;
		}
	}

	if (path.indexOf('/template') == 0) {
		if (path == '/template' && req.method == 'GET') {
			fs.readdir('./templates', function (err, files) {
				if (err)
					return send(500, err.message);

				let res = files.filter((file) => file.substr(-5) == '.json').map((file) => file.slice(0, -5));
				json(res);
			});
			return;	
		}

		let template = './templates/' + qs.unescape(path.substring(10)) + '.json';
		if (req.method == 'GET') 
			return fs.readFile(template, {encoding: 'utf-8'}, onDone);

		if (req.method == 'POST')
			return parseBody((body) => fs.writeFile(template, body.varbind_list, {encoding: 'utf-8'}, onDone));

		if (req.method == 'DELETE')
			return fs.unlink(template, onDone);
	}

	if (path == '/scan' && req.method == 'GET') {
		let proc = nmap.ping(query.range, Device.getIpList().join(','), onDone);
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
			return send(200);
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

function getAccess(ip) {
	let edit = config && config.access && config.access.edit instanceof Array && config.access.edit || ['127.0.0.1', '::ffff:127.0.0.1', 'localhost'];
	let view = config && config.access && config.access.view instanceof Array && config.access.view;

	return (edit.indexOf(ip) != -1) ? 'edit' :
		(!view || view.indexOf(ip) != -1) ? 'view' : 
		'none';
}

// Init cache and run polling
Device.cache(function (err) {
	if (err) {
		console.error(err.message);
		process.exit(1);
		return;
	}
	
	Device.getList().forEach((device) => device.polling());
});

Alert.getSummary((err, res) => err ? console.error(err.message) : alert_summary = res);

// Web notifier by socket 
let	wss = new WebSocket.Server({ 
	port: parseInt(config.port || 5000) + 1,
	clientTracking: true
});

wss.on('connection', function (ws, req) {
	ws.on('message', function (msg) { 
		ws.device_id = (/device\/([\d]*)/g).test(msg) ? parseInt(msg.substring(8)) : 0;
	});
	
	let packet;
	packet = {event: 'alert-summary', warning: alert_summary.warning, critical: alert_summary.critical};
	ws.send(JSON.stringify(packet));

	let ip = !req ? ws._socket.address().address : req.connection.remoteAddress;
	packet = {event: 'access', access: getAccess(ip)};
	ws.send(JSON.stringify(packet));
});

function broadcast(packet, filter) {
	if (!wss || !wss.clients)
		return;

	wss.clients.forEach(function(client) {
		if (filter && !filter(client))
			return;
		
		try {
			if (packet)	
				client.send(JSON.stringify(packet));
			else
				client.ping('ping');	
		} catch (err) {}
	})
}

setInterval(function () {
	broadcast(null, (client) => client.readyState == WebSocket.OPEN)
}, 10000);

Device.events.on('values-updated', function (device, time) {
	let values = device.varbind_list.map((v) => new Object({id: v.id, prev_value: v.prev_value, value: v.value, value_type: v.value_type, status: v.status || 0}));
	let packet = {event: 'values-updated', id: device.id, values, time}
	broadcast(packet, (client) => client.device_id == device.id);	
});

Device.events.on('status-updated', function(device) {
	let packet = {event: 'status-updated', id: device.id, status: device.status}
	broadcast(packet);
});

Device.events.on('status-changed', function(device, reason) {
	if (device.status != 2 && device.status != 3)
		return;

	alert_summary[device.status == 2 ? 'warning' : 'critical']++;

	let packet = {event: 'alert-summary', warning: alert_summary.warning, critical: alert_summary.critical};
	broadcast(packet);

	let time = new Date().getTime();
	Alert.add(time, device.status, device.id, reason, function (err, id) {
		if (err) 
			return console.error(err.message)

		let packet = {event: 'alert-info', id, time, reason, status: device.status, device_name: device.name, device_id: device.id};
		broadcast(packet, (client) => !client.device_id);
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

	device.updateParent(function(err, parent) {
		if (err) {
			console.error(err);
			return run(event);
		}

		if (parent)
			return nmap.ping(parent.ip, null, (err, res) => (err || res && res[0] && res[0].alive) ? run(event) : null);
	})
})

// Publisher
function startPublisher () {
	let opts = config.publisher;
	if (!opts)
		return;

	const net = require('net');
	let clients = [];

	function start () {
		function onConnect (socket) {
			clients.push(socket);
			socket.on('error', (err) => console.error (__filename, err.message));
			socket.on('end', function () {
				clients.splice(clients.indexOf(socket), 1);
				if (opts.host)
					start();
			});
		}

		if (!opts.host)
			net.createServer(onConnect).listen(opts.port || (parseInt(config.port) + 2) || 5002);
		else
			net.createConnection(opts.host, opts.port || 2003, onConnect);
	}
	start();		

	Device.events.on('values-updated', function (device, time) {
		clients.forEach(function (socket) {
			device.varbind_list.forEach(function(varbind) {
				if (varbind.is_temporary || !!opts['only-numeric'] && varbind.value_type != 'number')
					return;

				try {
					socket.write((opts.pattern ? eval(`\`${opts.pattern}\``) : device.name + '/' + varbind.name + ' ' + varbind.value + ' ' + time) + (opts.EOL || '\r\n'));
				} catch (err) {
					console.error(err);
				}
			});
		});
	});	
}
startPublisher();

// nmap ping by timer
function runPing (delay) {
	if (delay)
		return setTimeout(runPing, config['ping-period'] * 1000 || 300000);

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
		return setTimeout(runAutoScan, params.period * 1000 || 300000);

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

// Event catchers e.g. snmptrapd
let catchers = config.catchers;
if (catchers && catchers instanceof Array && catchers.length > 0) {
	catchers.forEach(function (opts) {
		let catcher = child_process.spawn(opts.command, opts.args || [], opts.options || {});
	
		var re;
		try {
			re = new RegExp(opts.regexp);	
		} catch (err) {
			return console.error(__filename, err);
		}
		
		function onData(data) {
			let ip = re.exec(data);
			if (!ip)
				return;
			
			Device.getList()
				.filter((device) => device.ip == ip)
				.forEach((device) => device.polling());
		} 
		
		catcher.stdout.on('data', onData);
		catcher.stderr.on('data', onData);
		catcher.on('close', (code) => console.error(__filename, `Catcher ${opts.command} crashed with code ${code}`));
	})
}

exec('wmic /?', (err) => (err) ? console.error('wmic not found') : null);
exec('nmap /?', (err) => (err) ? console.error('nmap not found') : null);