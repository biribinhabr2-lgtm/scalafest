'use strict';
const svc  = require('./dispatch.service');
const repo = require('./dispatch.repo');

const ok  = (res, d, s = 200) => res.status(s).json(d);
const err = (res, e, s = 500) => res.status(s).json({ error: e.message });
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { err(res, e); } };

module.exports = {
  list: wrap(async (req, res) => {
    const data  = req.query.data || new Date().toISOString().slice(0, 10);
    const { data: d, error } = await repo.listByDate(req.adminId, data);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),

  listAll: wrap(async (req, res) => {
    const { data: d, error } = await repo.listByAdmin(req.adminId, Number(req.query.limit) || 50);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),

  livePanel: wrap(async (req, res) => {
    const { data: d, error } = await repo.livePanel(req.adminId);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),

  get: wrap(async (req, res) => {
    const { data: d, error } = await repo.get(req.params.id);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),

  create: wrap(async (req, res) => {
    ok(res, await svc.criar(req.adminId, req.body), 201);
  }),

  update: wrap(async (req, res) => {
    const { data: d, error } = await repo.update(req.params.id, req.adminId, req.body);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),

  remove: wrap(async (req, res) => {
    const { error } = await repo.remove(req.params.id, req.adminId);
    if (error) throw new Error(error.message);
    ok(res, { ok: true });
  }),

  calcRoute: wrap(async (req, res) => {
    ok(res, await svc.calcularRota(req.params.id, req.adminId));
  }),

  navUrl: wrap(async (req, res) => {
    ok(res, await svc.urlNavegacao(req.params.id));
  }),

  updateStatus: wrap(async (req, res) => {
    const { status, obs, por } = req.body ?? {};
    if (!status) return res.status(400).json({ error: 'status é obrigatório.' });
    ok(res, await svc.atualizarStatus(req.params.id, status, { obs, por }));
  }),

  history: wrap(async (req, res) => {
    const { data: d, error } = await repo.getHistory(req.params.id);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),

  optimize: wrap(async (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    ok(res, await svc.otimizarDia(req.adminId, data));
  }),

  dashboard: wrap(async (req, res) => {
    ok(res, await svc.dashboard(req.adminId));
  }),

  confirmar: wrap(async (req, res) => {
    ok(res, await svc.confirmar(req.params.id, req.adminId));
  }),

  // Driver endpoint — uses motoristaId from token
  driverRoutes: wrap(async (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    const { data: d, error } = await repo.listByDriver(req.motoristaId, data);
    if (error) throw new Error(error.message);
    ok(res, d);
  }),
};
