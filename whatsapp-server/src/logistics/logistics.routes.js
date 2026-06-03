'use strict';

const { Router } = require('express');
const driverRoutes   = require('./modules/drivers/driver.routes');
const vehicleRoutes  = require('./modules/vehicles/vehicle.routes');
const pointRoutes    = require('./modules/points/point.routes');
const dispatchRoutes = require('./modules/dispatch/dispatch.routes');
const configRoutes   = require('./modules/config/config.routes');
const driverCtrl     = require('./modules/drivers/driver.controller');
const dispatchCtrl   = require('./modules/dispatch/dispatch.controller');

const router = Router();

/**
 * adminId middleware — extracts adminId from request body, query or header.
 * Also deletes it from req.body so repos don't accidentally spread it into
 * Supabase queries (Supabase would complain: column "adminId" does not exist).
 */
const withAdmin = (req, res, next) => {
  const adminId = req.body?.adminId || req.query?.adminId || req.headers['x-admin-id'];
  if (!adminId) return res.status(400).json({ error: 'adminId é obrigatório.' });
  req.adminId = adminId;
  if (req.body && req.body.adminId !== undefined) delete req.body.adminId;
  next();
};

/**
 * Driver auth middleware — extracts motoristaId from header (set after login).
 */
const withDriver = (req, res, next) => {
  const mid = req.headers['x-motorista-id'];
  if (!mid) return res.status(401).json({ error: 'x-motorista-id header ausente.' });
  req.motoristaId = mid;
  next();
};

/**
 * Accepts EITHER admin (x-admin-id / adminId) OR driver (x-motorista-id) auth.
 * Used for the status update endpoint so both admin panel and driver app can call it.
 * Also strips adminId from body to prevent Supabase "column not found" errors.
 */
const withAdminOrDriver = (req, res, next) => {
  const adminId    = req.body?.adminId || req.query?.adminId || req.headers['x-admin-id'];
  const motoristaId = req.headers['x-motorista-id'];
  if (adminId) {
    req.adminId = adminId;
    if (req.body && req.body.adminId !== undefined) delete req.body.adminId;
    return next();
  }
  if (motoristaId) { req.motoristaId = motoristaId; return next(); }
  return res.status(401).json({ error: 'Autenticação necessária (adminId ou x-motorista-id).' });
};

// ── Driver-only routes — MUST come BEFORE admin dispatch mount ────────────────
// These bypass withAdmin so the driver app can call them with x-motorista-id only.

// GET  /api/logistics/my-routes  — driver's assignments for today
router.get('/my-routes', withDriver, dispatchCtrl.driverRoutes);

// POST /api/logistics/dispatch/:id/status — driver OR admin updates status
router.post('/dispatch/:id/status', withAdminOrDriver, dispatchCtrl.updateStatus);

// GET  /api/logistics/dispatch/:id/navegar — driver opens Google Maps nav URL
// No auth check: URL only contains addresses (no sensitive data); API_SECRET still applies.
router.get('/dispatch/:id/navegar', dispatchCtrl.navUrl);

// ── Driver login — public (no adminId, no motoristaId needed) ─────────────────
router.post('/drivers/auth/login', driverCtrl.login);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.use('/drivers',  withAdmin, driverRoutes);
router.use('/vehicles', withAdmin, vehicleRoutes);
router.use('/points',   withAdmin, pointRoutes);
router.use('/dispatch', withAdmin, dispatchRoutes);
router.use('/config',   withAdmin, configRoutes);

module.exports = router;
