'use strict'
const cache = require('./cache');

module.exports = {
	get: function(type) {
		return {
			getList() { return cache.getList(type) },
			get(id, cloned) { 
				let obj = cache.get(type, id);
				return (obj && cloned) ? Object.assign(new obj.constructor, obj) : obj;
			}
		}
	},
	cache: function (opt) {
		if (opt == 'CLEAR') 
			return cache.unset(this.__type__, this.id);

		return cache.set(this.__type__, this);
	}
}

