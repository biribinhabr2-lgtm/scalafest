'use strict';

const { Router } = require('express');
const whatsappRoutes   = require('./whatsapp.routes');
const escalaRoutes     = require('./escala.routes');
const rosterRoutes     = require('./roster.routes');
const logisticsRoutes  = require('../logistics/logistics.routes');
const templatesRoutes  = require('./templates.routes');

const router = Router();

router.use('/whatsapp',   whatsappRoutes);
router.use('/escala',     escalaRoutes);
router.use('/roster',     rosterRoutes);
router.use('/logistics',  logisticsRoutes);
router.use('/templates',  templatesRoutes);

module.exports = router;
