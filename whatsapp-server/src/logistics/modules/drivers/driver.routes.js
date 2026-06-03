'use strict';
const { Router } = require('express');
const ctrl = require('./driver.controller');
const r = Router();

r.get   ('/',         ctrl.list);
r.get   ('/:id',      ctrl.get);
r.post  ('/',         ctrl.create);
r.put   ('/:id',      ctrl.update);
r.delete('/:id',      ctrl.remove);
r.post  ('/auth/login', ctrl.login);   // público — sem adminId

module.exports = r;
