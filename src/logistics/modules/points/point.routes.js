'use strict';
const { Router } = require('express');
const c = require('./point.controller');
const r = Router();
r.get('/', c.list); r.get('/:id', c.get); r.post('/', c.create); r.put('/:id', c.update); r.delete('/:id', c.remove);
module.exports = r;
