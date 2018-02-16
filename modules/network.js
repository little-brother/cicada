'use strict'
// child_process.exec can't be stopped (bug?), but child_process.execFile can
// Also execFile is more safely.
const execFile = require('child_process').execFile;
const fs = require('fs');
const is_windows = require('os').type().toLowerCase().indexOf('win') != -1;

let commands = {
	arp: 'arp -a',
	ping: is_windows ? 'ping ${ip} -n 2' : 'ping ${ip} -n 2 -i 0.3',
	trace: is_windows ? 'tracert -d ${ip}' : 'traceroute -n -I ${ip}'
}

let ping_processes = [];
let macs;

// convert command line 'ping 127.0.0.1 -n 10' to array [ping, 127.0.0.1, -n, 10]
function toArgs(cmd) {
	const re = /^"[^"]*"$/; // Check if argument is surrounded with double-quotes
	const re2 = /^([^"]|[^"].*?[^"])$/; // Check if argument is NOT surrounded with double-quotes
	
	let arr = [];
	let argPart = null;
	
	cmd && cmd.split(' ').forEach(function(arg) {
		if ((re.test(arg) || re2.test(arg)) && !argPart) 
			return arr.push(arg);

		argPart = argPart ? argPart + ' ' + arg : arg;
		if (/"$/.test(argPart)) {
			arr.push(argPart);
			argPart = null;
		}
	});
	
	return arr;
}

function setCommands(cmds) {
	return Object.assign(commands, cmds);
}
 
function ping (ip, callback) {
	if (!ip)
		return callback(new Error('The ip is not specified'));

	if (ip.length > 46)
		return callback(new Error('Incorrect ip: ' + ip));

	let args = toArgs(commands.ping.replace(/\$\{ip\}/g, ip));
	let proc = execFile(args[0], args.slice(1), function (err, stdout, stderr) {	
		if (err || stderr)
			return callback(err || new Error(stderr));

		let latencies = (stdout || '')
			.toLowerCase()
			.split('\n')
			.filter((line) => line.indexOf('\ ttl') != -1)
			.map((line) => line.match(/(\d+\.\d+|\d+)/g))
			.map((arr) => is_windows ? arr.length > 2 && arr[arr.length - 2] : arr[arr.length])
			.map((latency) => parseFloat(latency))
			.filter((latency) => !isNaN(latency));

		if (!latencies.length)
			return callback(new Error('Timeout'));

		callback(null, Math.max.apply(Math, latencies));
	});

	return proc;
}

// IPv4 only =(
function parseRange(range) {
	let res = range.split('.').map(function(section) {
		if (!isNaN(section)) 
			return [parseInt(section)];
		
		if (section.indexOf('-') !== -1) {
			let r = section.split('-');
			let n = parseInt(r[0]);
			let m = parseInt(r[1]);
			if (n > m) {
				n = parseInt(r[1]);
				m = parseInt(r[0]);
			}
	
			let a = [];
			for (let i = n; i <= m; i++) 
				a.push(i);
			
			return a;
		} 
			
		if (section === '*') 
			return Array.apply(null, {length: 255}).map(Number.call, Number);
	});
	
	let list = [];
	if(res.length < 4 || res.length > 4 || !res[0] || !res[1] || !res[2] || !res[3])
		throw new Error('Incorrect range: ' + range);
	
	res[0].forEach(function(a) {
		res[1].forEach(function(b) {
			res[2].forEach(function(c) {
				res[3].forEach(function(d) {
					list.push([a, b, c, d].join('.'))
				});
			});
		});
	});
	
	return list;
}

function scan (range, exclude, callback) {
	if (!macs) {
		fs.readFile('./etc/mac.txt', function (err, data) {
			if (err)	
				console.error(__filename, err.message);
			
			macs = {};	
			(data || '').toString()
				.split('\n')
				.forEach(function (line) {
					let row = line.split('\t');
					macs[row[0]] = row[1];
				});
			scan(range, exclude, callback);		
		});
		return;
	}

	let ip_list = [];

	try {
		range
			.split(/[ ,]+/)
			.map(parseRange)
			.forEach((range) => Array.prototype.push.apply(ip_list, range));
	} catch (err) {
		return callback(err);
	}	 

	if (exclude && exclude instanceof Array && exclude.length)
		ip_list = ip_list.filter((e) => exclude.indexOf(e) == -1);

	if (!ip_list.length)
		return callback(null, []);

	let no = 0;
	let res = [];

	function test(ip, i) {
		let proc = ping(ip, function (err, latency) {
			if (!err && !isNaN(latency))
				res.push({ip, latency}); // To-Do: arp -a => MAC + vendor

			no++;
			if (no >= ip_list.length) {	
				ping_processes = [];

				let args = toArgs(commands.arp);
				let proc = execFile(args[0], args.slice(1), function (err, stdout, stderr) {	
					if (err || stderr)
						return callback(null, res);

					let arps = {};
					stdout
						.split('\n')
						.map((line) => line.match(/\S+/gi))
						.filter((row) => !!row && row.length > 1)
						.forEach((row) => arps[row[0]] = row[1]);

					res.forEach(function(e) {
						let mac = (arps[e.ip] || '').toUpperCase().split(/\W+/g);
						e.mac = mac.join(':');

						if (mac.length != 6)
							return;

						e.vendor = macs[mac[0] + mac[1] + mac[2] + mac[3] + mac[4]] ||
							macs[mac[0] + mac[1] + mac[2] + mac[3]] || 
							macs[mac[0] + mac[1] + mac[2]] || 
							macs[mac[0] + mac[1]] || 
							macs[mac[0]];
					});

					callback(null, res);
				});
			}	
		});
		ping_processes.push(proc);
	}

	ip_list.forEach(test);
}

function stopScan () {
	ping_processes.forEach(function(proc) {
		try {
			proc.stdin.pause(); 
			proc.kill();
		} catch (err) { }
	})

	ping_processes = [];
}

function trace (ip, callback) {
	if (!ip)
		return callback(new Error('The ip is not specified'));

	if (ip.length > 46)
		return callback(new Error('Incorrect ip: ' + ip));

	let args = toArgs(commands.trace.replace(/\$\{ip\}/g, ip));
	let proc = execFile(args[0], args.slice(1), function (err, stdout, stderr) {
		if (err || stderr)
			return callback(err || new Error(stderr));

		let hops = (stdout || '')
			.toLowerCase()
			.split('\n')
			.filter((line) => line.indexOf('*') == -1 && !isNaN(parseInt(line)))
			.map((line) => line.match(/\S+/gi))
			.map((arr) => is_windows ? arr[arr.length - 1] : arr.length > 2 && arr[1]);

		if (!hops.length)
			return callback(new Error('Timeout'));

		callback(null, hops);
	});
}

module.exports = {setCommands, ping, scan, stopScan, trace}