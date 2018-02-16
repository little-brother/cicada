'use strict'
const crypto = require('crypto');

let sessions = {};
Object.assign(Session, {get: (id) => sessions[id]});

function Session(props) {
	Object.assign(this, props);
	let sid = crypto.randomBytes(32).toString('hex');
	this.id = sid;
	sessions[sid] = this;
}

module.exports = Session;