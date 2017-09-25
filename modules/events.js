'use strict'
const EventEmitter = require('events');
class EventManager extends EventEmitter {}
const eventManager = new EventManager();

module.exports = eventManager;