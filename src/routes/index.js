'use strict';

const { Router } = require('express');
const whatsappRoutes  = require('./whatsapp.routes');
const escalaRoutes    = require('./escala.routes');
const logisticsRoutes = require('../logistics/logistics.routes');

const router = Router();

router.use('/whatsapp',  whatsappRoutes);
router.use('/escala',    escalaRoutes);
router.use('/logistics', logisticsRoutes);

module.exports = router;
