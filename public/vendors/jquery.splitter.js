// https://github.com/shunjikonishi/jquery-splitter
(function (factory) {
  if(typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory(require("jquery"), window, document);
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
			var horizontal = current.orientation() == "horizontal";
			var rbSize = 0;
			if (current.resizebar) {
				rbSize = horizontal ? current.resizebar.outerWidth(true) : current.resizebar.outerHeight(true);
			}
			var keepLeft = current.keepLeft();
			
			if (horizontal) {
				var cw = parent.width();
				var l, r;
				if (keepLeft) {
					l = div1.outerWidth(true);
					if (l > cw) {
						l = cw;
					}
					r = cw - l - rbSize;
					if (r < 0) {
						r = 0;
					}
				} else {
					r = div2.outerWidth(true);
					if (r > cw) {
						r = cw;
					}
					l = cw - r - rbSize;
					if (l < 0) {
						l = 0;
					}
				}
				current.position(l);
				parent.height(Math.max(div1.height() || 0, div2.height() || 0));
			} else {
				var ch = parent.height();
				var t, b;
				if (keepLeft) {
					t = div1.outerHeight(true);
					if (t > ch) {
						t = ch;
					}
					b = ch - t - rbSize;
					if (b < 0) {
						b = 0;
					}
				} else {
					b = div2.outerHeight(true);
					if (b > ch) {
						b = ch;
					}
					t = ch - b - rbSize;
					if (t < 0) {
						t = 0;
					}
				}
				current.position(t);
			}
			if (current.windowResized()) {
				curent.windowResized()(ev);
			}
		}
		
		$(document.documentElement).mousedown(function(ev) {
			var buttonState = typeof(ev.buttons) === "undefined" ? ev.which : ev.buttons;
			if (buttonState !== 1) {
				return;
			}
			dragObj = current;
			if (dragObj) {
				bgColor = dragObj.resizebar.css("background-color");
				dragObj.resizebar.css("background-color", '#696969');
				var $body = $('body');
				$body.css('cursor', dragObj.resizebar.css("cursor"));
				if (!overlay) {
					overlay = $("<div class='splitter-overlay'/>").css({
						position: "absolute",
						width: "100%",
						height: "100%",
						left: 0,
						top: 0,
						"z-index": 9999
					});
				}
				$body.append(overlay);
				return false;
			}
		}).mouseup(function() {
			if (dragObj) {
				dragObj.resizebar.css("background-color", bgColor);
				$('body').css('cursor', 'auto');
			}
			if (overlay) {
				overlay.remove();
				overlay = null;
			}
			dragObj = null;
		}).mousemove(function(ev) {
			if (!dragObj) {
				return;
			}
			var buttonState = typeof(ev.buttons) === "undefined" ? ev.which : ev.buttons;
			if (!buttonState) {
				dragObj = null;
				return;
			}
			var horizontal = dragObj.orientation() == "horizontal";
			if (horizontal) {
				var pw = dragObj.parent.width();
				var x = ev.clientX - dragObj.parent.offset().left;
				if (x < 0) {
					x = 0;
				} else if (x > pw) {
					x = pw;
				}
				dragObj.position(x);
			} else {
				var ph = dragObj.parent.height();
				var y = ev.clientY - dragObj.parent.offset().top;
				if (y < 0) {
					y = 0;
				} else if (y > ph) {
					y = ph;
				}
				dragObj.position(y);
			}
			if (dragObj.paneResized()) {
				dragObj.paneResized()(ev);
			}
			for (var i=0; i<splitters.length; i++) {
				var pane = splitters[i];
				if (pane != current) {
					doResize(pane, ev);
				}
			}
		});
		
		$(window).resize(function(ev){
			for (var i=0; i<splitters.length; i++) {
				doResize(splitters[i], ev);
			}
		});
		function setCurrent(c) {
			current = c;
		}
		function add(splitter) {
			splitters.push(splitter);
		}
		function release(splitter) {
			var idx = -1;
			for (var i=0; i<splitters.length; i++) {
				if (splitters[i] == splitter) {
					idx = i;
					break;
				}
			}
			if (idx >= 0) {
				splitters.splice(idx, 1);
			}
		}
		$.extend(this, {
			"size": function() {
				return splitters.length;
			},
			"setCurrent" : setCurrent,
			"add" : add,
			"release" : release
		});
	}
	/**
	 * The splitter for element
	 * @param parrent - parent element
	 * @param div1 - The element which placed in above or left in parent element
	 * @param div1 - The element which placed in below or right in parent element
	 * @param horizontal - If true, this makes horizontal split, or vertical split.
	 */
	function Splitter(parent, div1, div2, horizontal, barwidth) {
		if (!manager) {
			manager = new SplitterManager();
		}
		manager.add(this);
		var self = this,
			keepLeft = true,
			limit = 0,
			paneResized = null,
			windowResized = null,
			parent = $(parent),
			div1 = $(div1),
			div2 = $(div2),
			resizebar = $("<div class='splitter-resizebar'></div>").appendTo(parent);
		resizebar.addClass("splitter-" + manager.size);
		resizebar.css({
			"background-color" : "#a9a9a9",
			"position" : "absolute",
			"z-index" : 20,
			"overflow" : "hidden"
		}).mouseenter(function() {
			manager.setCurrent(self);
		}).mouseleave(function() {
			manager.setCurrent(null);
		});
		if (horizontal) {
			var w1 = div1.outerWidth(true);
			var w2 = parent.width() - w1;
			div1.css({
				"position" : "absolute",
				"overflow-x" : "auto",
				"left" : 0,
				"width" : w1
			});
			resizebar.css({
				"left" : w1,
				"width" : barwidth,
				"height" : "100%",
				"cursor" : "col-resize"
			});
			var w3 = resizebar.outerWidth(true);
			div2.css({
				"position" : "absolute",
				"overflow-x" : "auto",
				"right" : 0,
				"width" : w2 - w3
			});
		} else {
			var h1 = div1.outerHeight(true);
			var h2 = div2.outerHeight(true);
			div1.css({
				"position" : "absolute",
				"overflow-y" : "auto",
				"top" : 0,
				"height" : h1
			});
			resizebar.css({
				"top" : h1,
				"width" : "100%",
				"height" : barwidth,
				"cursor" : "row-resize"
			});
			var h3 = resizebar.outerHeight(true);
			div2.css({
				"position" : "absolute",
				"overflow-y" : "auto",
				"bottom" : 0,
				"height" : h2 - h3
			});
		}
		$.extend(this, {
			"parent" : parent,
			"div1" : div1,
			"div2" : div2,
			"resizebar" : resizebar,
			"orientation" : function() {
				var cursor = self.resizebar.css("cursor").toLowerCase();
				return cursor == "col-resize" ? "horizontal" : "vertical";
			},
			"paneResized" : function(func) {
				if (func === undefined) {
					return paneResized;
				} else {
					paneResized = func;
					return self;
				}
			},
			"windowResized" : function(func) {
				if (func === undefined) {
					return windowResized;
				} else {
					windowResized = func;
					return self;
				}
			},
			"keepLeft" : function(b) {
				if (b === undefined) {
					return keepLeft;
				} else {
					keepLeft = b;
					return self;
				}
			},
			"limit" : function(n) {
				if (n === undefined) {
					return limit;
				} else {
					limit = n;
					return self;
				}
			},
			"position" : function(n) {
				if (self.orientation() == "horizontal") {
					if (n === undefined) {
						return resizebar.css("left");
					} else {
						var low = limit;
						var high = parent.width() - limit;
						if (n < low) {
							n = low;
						} else if (n > high) {
							n = high;
						}
						resizebar.css("left", n);
						div1.css("width", n);
						div2.css("width", parent.width() - resizebar.outerWidth(true) - n);
					}
				} else {
					if (n === undefined) {
						return resizebar.css("top");
					} else {
						var low = limit;
						var high = parent.height() - limit;
						if (n < low) {
							n = low;
						} else if (n > high) {
							n = high;
						}
						resizebar.css("top", n);
						div1.css("height", n);
						div2.css("height", parent.height() - resizebar.outerHeight(true) - n);
					}
				}
				return self;
			},
			"release" : function() {
				manager.release(self);
				return self;
			}
		});
	}
	var manager = null;
	
	$.fn.splitter = function(options) {
		var div1 = this.children().first();
		var div2 = div1.next();
		var settings = {
			"div1" : div1,
			"div2" : div2,
			"orientation" : "horizontal",
			"limit" : 0,
			"keepLeft" : true,
			"paneResized" : null,
			"windowResized" : null,
			"barwidth": 2
		};
		if (options) {
			$.extend(settings, options);
		}
		if (settings.orientation === "horizontal") {
			this.css("width", "100%");
			if (div1.width() === this.width()) {
				div1.css("width", Math.floor(this.width() / 10 * 3));
			}
		} else {
			this.css("height", "100%");
			var h1 = div1.height();
			if (h1 < (this.height() / 10) || settings.limit > 0 && h1 < settings.limit) {
				h1 = settings.limit || 200;
				div1.css("height", settings.limit || 200);
			}
			div2.css("height", this.height() - h1);
		}
		var splitter = new Splitter(this, settings.div1, settings.div2, settings.orientation == "horizontal", settings.barwidth);
		splitter.limit(settings.limit);
		splitter.keepLeft(settings.keepLeft);
		splitter.paneResized(settings.paneResized);
		splitter.windowResized(settings.windowResized);
		return splitter;
	}
}));