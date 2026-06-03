'use strict';
const { Router } = require('express');
const repo = require('./config.repo');
const r = Router();

r.get('/', async (req, res) => {
  try { res.json(await repo.get(req.adminId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

r.put('/', async (req, res) => {
  try { res.json(await repo.upsert(req.adminId, req.body)); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
