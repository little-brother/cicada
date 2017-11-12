// Based on https://github.com/shunjikonishi/jquery-splitter

(function (factory) {
  if(typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('jquery'), window, document);
  } else {
    factory(jQuery, window, document);
  }
}(function($, window, document, undefined) {
	function SplitterManager() {
		var splitters = [],
			current = null,
			bgColor = null,
			dragObj = null,
			overlay = null;

		function doResize(current, ev) {
			var parent = current.parent;
			var div1 = current.div1;
			var div2 = current.div2;
			var rbSize = 0;
			if (current.resizebar) 
				rbSize = current.resizebar.outerWidth(true);
			
			var cw = parent.width();
			var l = Math.min(div1.outerWidth(true), cw);
			var r = Math.max(cw - l - rbSize, 0);
			current.position(l);
			//parent.height(Math.max(div1.height() || 0, div2.height() || 0));
			
			if (current.onWindowResize)
				current.onWindowResize(ev, current);
		}
		
		$(document.documentElement).mousedown(function(ev) {
			var buttonState = typeof(ev.buttons) === 'undefined' ? ev.which : ev.buttons;
			if (buttonState !== 1) 
				return;
			
			dragObj = current;
			if (dragObj) {
				bgColor = dragObj.resizebar.css('background-color');
				dragObj.resizebar.css('background-color', '#696969');
				var $body = $('body');
				$body.css('cursor', dragObj.resizebar.css('cursor'));
				if (!overlay) {
					overlay = $('<div/>')
						.addClass('splitter-overlay')
						.css({
							position: 'absolute',
							width: '100%',
							height: '100%',
							left: 0,
							top: 0,
							'z-index': 9999
						});
				}
				$body.append(overlay);
				return false;
			}
		}).mouseup(function(ev) {
			if (dragObj) {
				dragObj.resizebar.css('background-color', bgColor);
				$('body').css('cursor', 'auto');
			}

			if (overlay) {
				overlay.remove();
				overlay = null;
			}

			if (dragObj && dragObj.onDragEnd)
				dragObj.onDragEnd(ev, dragObj)	

			dragObj = null;
		}).mousemove(function(ev) {
			if (!dragObj) 
				return;
			
			var buttonState = typeof(ev.buttons) === 'undefined' ? ev.which : ev.buttons;
			if (!buttonState) {
				dragObj = null;
				return;
			}

			var pw = dragObj.parent.width();
			var x = ev.clientX - dragObj.parent.offset().left;
			if (x < 0) {
				x = 0;
			} else if (x > pw) {
				x = pw;
			}
			dragObj.position(x);
			
			if (dragObj.onDrag) 
				dragObj.onDrag(ev, dragObj);
			
			splitters
				.filter((splitter) => splitter != current)
				.forEach((splitter) => doResize(splitter, ev));
		});
		
		$(window).resize((ev) => splitters.forEach((s) => doResize(s, ev)));
		
		$.extend(this, {
			length: () => splitters.length,
			setCurrent: (splitter) => current = splitter,
			add: (splitter) => splitters.push(splitter),
			release: (splitter) => splitters = splitters.filter((s) => s != splitter)
		});
	}

	function Splitter(opts) {
		if (!manager) 
			manager = new SplitterManager();
		
		manager.add(this);
		var self = this,
			limit = 0,
			parent = $(opts.parent),
			div1 = $(opts.div1),
			div2 = $(opts.div2),
			resizebar = $('<div/>');

		resizebar
			.addClass('splitter-resizebar')
			.addClass('splitter-' + manager.length())
			.css({
				'background-color' : '#a9a9a9',
				'position' : 'absolute',
				'z-index' : 20,
				'overflow' : 'hidden'
			})
			.mouseenter(() => manager.setCurrent(self))
			.mouseleave(() => manager.setCurrent(null))
			.appendTo(parent);

		var w1 = div1.outerWidth(true);
		var w2 = parent.width() - w1;
		div1.css({
			'position' : 'absolute',
			'overflow-x' : 'auto',
			'left' : 0,
			'width' : w1
		});
		resizebar.css({
			'left' : w1,
			'width' : opts.barwidth,
			'height' : '100%',
			'cursor' : 'col-resize'
		});
		var w3 = resizebar.outerWidth(true);
		div2.css({
			'position' : 'absolute',
			'overflow-x' : 'auto',
			'right' : 0,
			'width' : w2 - w3
		});
	
		var w1 = div1.width();
		this.reset = function () {
			div1.width(w1);
			div2.width(parent.width() - div1.width() - resizebar.width());
			resizebar.css('left', w1);
		}	

		this.resizebar = resizebar;
		this.release = () => manager.release(self);
		this.position = function (n) {
			if (n === undefined) {
				return resizebar.css('left');
			} else {
				var low = limit;
				var high = parent.width() - limit;
				if (n < low) {
					n = low;
				} else if (n > high) {
					n = high;
				}
				resizebar.css('left', n);
				div1.css('width', n);
				div2.css('width', parent.width() - resizebar.outerWidth(true) - n);
			}
			
			return self;
		}

		$.extend(this, opts);
	}
	var manager = null;
	
	$.fn.splitter = function(options) {
		var div1 = this.children().first();
		var div2 = div1.next();
		var opts = {
			parent: this,
			div1: div1,
			div2: div2,
			limit: 0,
			barwidth: 2
		};
		
		$.extend(opts, options || {});

		this.css('width', '100%');		
		if (!div1.width() || div1.width() === this.width() && div2.width() != this.width()) 
			div1.width((this.width() - div2.width() - opts.barwidth) || 200);

		return new Splitter(opts);
	}
}));