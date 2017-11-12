'use strict'
let objects = {};
let collator = new Intl.Collator();

exports.set = function (type, object) {
	if (!type || !object || !object.id || parseInt(object.id) != object.id) {
		console.error(__filename, type, object)
		throw new Error('INTERNAL');
	}

	object.id = parseInt(object.id);

	if (!objects[type]) 
		objects[type] = [];
	object.__type__ = type;

	if (objects[type][object.id])
		Object.assign(objects[type][object.id], object);
	else
		objects[type][object.id] = object;

	return objects[type][object.id];
}

exports.unset = function (type, id) {
	if (!objects[type] || !objects[type][id])
		return null;

	delete objects[type][id];
	return {id, __type__: type};
}

exports.get = function (type, id) {
	return (objects[type]) ? objects[type][id] : null;
}

// If will be slow on large data then build and sort list inside @set-operator
exports.getList = function (type, unsorted) {
	if (!objects[type])
		return [];

	let res = objects[type].filter((e) => !!e);
	return !!unsorted ? res : res.sort((a, b) => ((a.name || b.name) ? collator.compare(a.name, b.name) : 0))
}

exports.getListRaw = function(type) {
	return objects[type].filter((e) => !!e);
}
 
