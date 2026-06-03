'use strict';
const { Router } = require('express');
const c = require('./dispatch.controller');
const r = Router();

r.get('/live',              c.livePanel);
r.get('/all',               c.listAll);
r.get('/optimize',          c.optimize);
r.get('/dashboard',         c.dashboard);
r.get('/',                  c.list);
r.post('/',                 c.create);
r.get('/:id',               c.get);
r.put('/:id',               c.update);
r.delete('/antigas',        c.limparAntigas);
r.delete('/:id',            c.remove);
r.post('/:id/calcular',     c.calcRoute);
r.post('/:id/confirmar',    c.confirmar);
r.get('/:id/navegar',       c.navUrl);
r.post('/:id/status',       c.updateStatus);
r.get('/:id/historico',     c.history);

module.exports = r;
