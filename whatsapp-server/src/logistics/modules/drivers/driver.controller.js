'use strict';
const svc = require('./driver.service');

const ok  = (res, data, status = 200) => res.status(status).json(data);
const err = (res, e)                  => res.status(500).json({ error: e.message });

module.exports = {
  list:   async (req, res) => { try { ok(res, await svc.listar(req.adminId));                              } catch (e) { err(res, e); } },
  get:    async (req, res) => { try { ok(res, await svc.buscar(req.params.id, req.adminId));               } catch (e) { err(res, e); } },
  create: async (req, res) => { try { ok(res, await svc.criar(req.adminId, req.body), 201);               } catch (e) { err(res, e); } },
  update: async (req, res) => { try { ok(res, await svc.atualizar(req.params.id, req.adminId, req.body)); } catch (e) { err(res, e); } },
  remove: async (req, res) => { try { await svc.remover(req.params.id, req.adminId); ok(res, { ok: true }); } catch (e) { err(res, e); } },
  login:  async (req, res) => {
    try {
      const { telefone, pin } = req.body ?? {};
      if (!telefone || !pin) return res.status(400).json({ error: 'Telefone e PIN obrigatórios.' });
      ok(res, await svc.autenticar(telefone, pin));
    } catch (e) { res.status(401).json({ error: e.message }); }
  },
};
