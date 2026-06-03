'use strict';
const repo = require('./vehicle.repo');
const ok  = (res, data, s = 200) => res.status(s).json(data);
const err = (res, e)             => res.status(500).json({ error: e.message });

const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) { err(res, e); }
};

module.exports = {
  list:   wrap(async (req, res) => { const { data, error } = await repo.list(req.adminId);                              if (error) throw new Error(error.message); ok(res, data); }),
  get:    wrap(async (req, res) => { const { data, error } = await repo.get(req.params.id, req.adminId);               if (error) throw new Error(error.message); ok(res, data); }),
  create: wrap(async (req, res) => { const { data, error } = await repo.create(req.adminId, req.body);                 if (error) throw new Error(error.message); ok(res, data, 201); }),
  update: wrap(async (req, res) => { const { data, error } = await repo.update(req.params.id, req.adminId, req.body); if (error) throw new Error(error.message); ok(res, data); }),
  remove: wrap(async (req, res) => { const { error } = await repo.remove(req.params.id, req.adminId);                 if (error) throw new Error(error.message); ok(res, { ok: true }); }),
};
