'use strict'
const fs = require('fs');
const path = require('path');
module.exports = fs.readdirSync(__dirname).reduce((r, f) => {r[path.parse(f).name] = require(__dirname + '/' + f); return r}, {});