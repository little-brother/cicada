function onDragEnd(event, splitter) {
	if (splitter.parent.find('#navigator').width() / splitter.parent.width() < 0.3)
		return;

	splitter.reset();
	$('.app').toggleClass('current');
}

function drawCircle(ctx, x, y, color, size) {
	ctx.beginPath();
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.arc(x, y, size || 1, 0, 2 * Math.PI, false);
	ctx.fill();
	ctx.stroke();
}

function drawLink(ctx, link) {
	var p1 = link.from;
	var p2 = link.to;
	ctx.lineWidth = link.depth || 10;

	ctx.strokeStyle = 
		(link.color == '@status' && link.status == 0) ? '#bbb' :
		(link.color == '@status' && link.status == 1) ? '#0f0' :
		(link.color == '@status' && link.status == 2) ? 'gold' :
		(link.color == '@status' && link.status == 3) ? '#f00' :
		(link.color == '@value' && link.value != undefined && link.value > 0 && link.value < 100) ? getColor(link.value) :
		!link.color || link.color == '@status' || link.color == '@value' ? '#000' : 
		link.color;

	ctx.fillStyle = ctx.strokeStyle;
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

	ctx.moveTo(0, 0);
	ctx.lineTo(hyp - arrow_w, 0);
	ctx.stroke();

	ctx.beginPath();
	ctx.lineTo(hyp - arrow_w, arrow_h);
	ctx.lineTo(hyp, 0);
	ctx.lineTo(hyp - arrow_w, -arrow_h);
	ctx.fill();

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

function roundTime(time) {
	var date = time && new Date(parseInt(time)) || new Date();
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return date.getTime();
}

var sndBeep = new Audio("data:audio/wav;base64,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qJrx4KOQjahZxWbcZgztj2c49nKmkId44S71j0c8eV9yDK6uPRzx5X18eDvjvQ6yKo9ZSS6l//8elePK/Lf//IInrOF/FvDoADYAGBMGb7FtErm5MXMlmPAJQVgWta7Zx2go+8xJ0UiCb8LHHdftWyLJE0QIAIsI+UbXu67dZMjmgDGCGl1H+vpF4NSDckSIkk7Vd+sxEhBQMRU8j/12UIRhzSaUdQ+rQU5kGeFxm+hb1oh6pWWmv3uvmReDl0UnvtapVaIzo1jZbf/pD6ElLqSX+rUmOQNpJFa/r+sa4e/pBlAABoAAAAA3CUgShLdGIxsY7AUABPRrgCABdDuQ5GC7DqPQCgbbJUAoRSUj+NIEig0YfyWUho1VBBBA//uQZB4ABZx5zfMakeAAAAmwAAAAF5F3P0w9GtAAACfAAAAAwLhMDmAYWMgVEG1U0FIGCBgXBXAtfMH10000EEEEEECUBYln03TTTdNBDZopopYvrTTdNa325mImNg3TTPV9q3pmY0xoO6bv3r00y+IDGid/9aaaZTGMuj9mpu9Mpio1dXrr5HERTZSmqU36A3CumzN/9Robv/Xx4v9ijkSRSNLQhAWumap82WRSBUqXStV/YcS+XVLnSS+WLDroqArFkMEsAS+eWmrUzrO0oEmE40RlMZ5+ODIkAyKAGUwZ3mVKmcamcJnMW26MRPgUw6j+LkhyHGVGYjSUUKNpuJUQoOIAyDvEyG8S5yfK6dhZc0Tx1KI/gviKL6qvvFs1+bWtaz58uUNnryq6kt5RzOCkPWlVqVX2a/EEBUdU1KrXLf40GoiiFXK///qpoiDXrOgqDR38JB0bw7SoL+ZB9o1RCkQjQ2CBYZKd/+VJxZRRZlqSkKiws0WFxUyCwsKiMy7hUVFhIaCrNQsKkTIsLivwKKigsj8XYlwt/WKi2N4d//uQRCSAAjURNIHpMZBGYiaQPSYyAAABLAAAAAAAACWAAAAApUF/Mg+0aohSIRobBAsMlO//Kk4soosy1JSFRYWaLC4qZBYWFRGZdwqKiwkNBVmoWFSJkWFxX4FFRQWR+LsS4W/rFRb/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////VEFHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU291bmRib3kuZGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMjAwNGh0dHA6Ly93d3cuc291bmRib3kuZGUAAAAAAAAAACU=");  
function beep() {
    sndBeep.play();
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