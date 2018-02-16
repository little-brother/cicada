function onDragEnd(event, splitter) {
	if (splitter.parent.find('#navigator').width() / splitter.parent.width() < 0.3)
		return;

	splitter.reset();
	$(window).trigger('toggle-app');
}

function drawCircle(ctx, x, y, color, size) {
	ctx.beginPath();
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.arc(x, y, size || 1, 0, 2 * Math.PI, false);
	ctx.fill();
	ctx.stroke();
}

function drawMark(ctx, x, y, color) {
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	
	ctx.beginPath();
	ctx.moveTo(x - 4, y);
	ctx.lineTo(x + 4, y);
	ctx.lineTo(x, y + 8);
	ctx.fill();
	ctx.stroke();
}

function drawLink(ctx, link) {
	var p1 = link.from;
	var p2 = link.to;
	ctx.lineWidth = link.depth || 10;

	ctx.fillStyle = 
		(link.color == '@status' && link.status == 0) ? '#bbb' :
		(link.color == '@status' && link.status == 1) ? '#0f0' :
		(link.color == '@status' && link.status == 2) ? 'gold' :
		(link.color == '@status' && link.status == 3) ? '#f00' :
		(link.color == '@value' && link.value != undefined && link.value > 0 && link.value < 100) ? getColor(link.value) :
		!link.color || link.color == '@status' || link.color == '@value' ? '#000' : 
		link.color;

	ctx.moveTo(p1.x, p1.y);

	var size = link.depth || 10;
	var arrow_h = (size < 8) ? 4 : size/2;
	var arrow_w = (size < 8) ? 10 : size/2;

	ctx.save();
	ctx.beginPath();	
	ctx.translate(p1.x, p1.y);
	var angle = Math.atan2((p2.y - p1.y) , (p2.x - p1.x));
	var hyp = Math.sqrt((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y));
	ctx.rotate(angle);

	if (size < 8) {
		ctx.strokeStyle = ctx.fillStyle;
		ctx.moveTo(0, 0);
		ctx.lineTo(hyp - arrow_w, 0);
		ctx.stroke();
	
		ctx.beginPath();
		ctx.lineTo(hyp - arrow_w, arrow_h);
		ctx.lineTo(hyp, 0);
		ctx.lineTo(hyp - arrow_w, -arrow_h);
		ctx.fill();
	} else {
		ctx.moveTo(0, arrow_h);
		ctx.lineTo(hyp - arrow_w, arrow_h);
		ctx.lineTo(hyp, 0);
		ctx.lineTo(hyp - arrow_w, -arrow_h);
		ctx.lineTo(0, -arrow_h);
		ctx.lineTo(0, arrow_h);
		ctx.fill();
		ctx.strokeStyle = '#bbb';
		ctx.lineWidth = 1;	
		ctx.stroke();
	}

	if (link.label) {		
		ctx.font = '14px Arial';			
		ctx.fillStyle = (size < 14) ? '#000' : ['#f012be', '#b10dc9', '#000'].indexOf(link.color) != -1 || !link.color ? '#fff' : '#000';
			
		var h = (size > 14) ? -5 : Math.max(size, 5);
		if (Math.PI/2 > Math.abs(angle)) {
			
			ctx.fillText(link.label, hyp - ctx.measureText(link.label).width - 10, -h);
		} else {
			ctx.translate(hyp - size/2, h)
			ctx.rotate(Math.PI);	
			ctx.fillText(link.label, 0, 0);
		}
	}

	ctx.restore();			
}

function getColor (percent) {
    var hue = ((1 - percent/100) * 120).toString(10);
    return ['hsl(', hue, ', 100%, 50%)'].join('');
}

function getStatusColor (status) {
    return status == 2 ? 'gold' :
		status == 3 ? '#f00' :
		status == 4 ? 'blue' :
		null;
}

// set non-numeric element to one of nearest
function normalizeHistory(data, col) {
	col = parseInt(col) || 1;
	data.forEach(function (row, no) {
		if ($.isNumeric(row[col])) // ? row[col] == null
			return;	

		row[col] = data[no - 1] != undefined && $.isNumeric(data[no - 1][col]) && data[no - 1][col] || data[no + 1] != undefined && $.isNumeric(data[no + 1][col]) && data[no + 1][col] || 0;
	});
}

function getRange(rows) {
	var min, max;
	rows.forEach(function (row) {
		for (var i = 1; i < row.length; i++) {
			var val = parseFloat(row[i]);
			min = (min == undefined && !isNaN(val) || !isNaN(val) && !isNaN(min) && min > val) ? val : min;
			max = (max == undefined && !isNaN(val) || !isNaN(val) && !isNaN(max) && max < val) ? val : max;
		}
	})
	var gap = (max - min) * 0.1;
	return [min - gap, max + gap];
}

function trim(x) {
	return Object.prototype.toString.call(x) === "[object String]" ? x.trim() : x;
}

function nvl (e, def) {
	return e != undefined ? e : def;
}

function round(x, n) {
	n = parseInt(n) || 1;
	return Math.ceil(x / n) * n;
}

function roundTime(time) {
	var date = time && new Date(parseInt(time)) || new Date();
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return date.getTime();
}

function getCookie(cookie) {
	var cookies = {};
	(document.cookie || '').split(';').map((pair) => pair.split('=')).forEach((e) => cookies[trim(e[0])] = trim(e[1]));
	return cookies[cookie];
}

function cast(type, value, hint) {
	type = (type + '').toLowerCase();

	if (!type || (value + '').indexOf('ERR: ') == 0)
		return value;

	if (value == null || value == undefined)
		return '';

	if(type == 'string')
		return value + '';

	if (type == 'number' && !isNaN(value)) {
		var factor = Math.pow(10, 2); // 2 digit after .
		return Math.round(value * factor) / factor;
	}	

	if ((type == 'time' || type == 'date' || type == 'datetime') && !isNaN(value) && !!value) {
		var datetime = {
			datetime : "%d.%m.%Y %H:%M",
			date : "%d.%m.%Y",
			time : "%H:%M",		
			pickmeup: "d.m.Y"
		}
		return strftime(datetime[type], new Date(parseInt(value) || value));
	}

	if (type == 'filesize' && !isNaN(value)) {
		var i = Math.floor(Math.log(value) / Math.log(1024));
		return (value / Math.pow(1024, i)).toFixed(2) * 1 + ['B', 'kB', 'MB', 'GB', 'TB'][i];		
	}

	if (type == 'onoff') 
		return ['On', 'Off'][parseInt(value) ? 0 : 1];

	if (type == 'yesno') 
		return ['Yes', 'No'][parseInt(value) ? 0 : 1];

	if (type == 'updown') 
		return ['Up', 'Down'][parseInt(value) ? 0 : 1];

	if (type == 'status') 
		return ['Unknown', 'Normal', 'Warning', 'Critical'][parseInt(value)];

	if (type == 'duration' && !isNaN(value)) {
		var min = 6000;
		var mhd = [Math.floor((value/min % 60)), Math.floor((value/(60 * min)) % 24), Math.floor(value/(24 * 60 * min))];
		var txt = ['m','h','d'];
		var res = (mhd[2] ? mhd[2] + txt[2] + ' ' : '') + (mhd[1] ? mhd[1] + txt[1] + ' ' : '') + ((hint != 'short' || mhd[0]) ? mhd[0] + txt[0] : '');
		return res.trim();
	}

	return value;
}

if (typeof module !== 'undefined')
	module.exports = {cast};