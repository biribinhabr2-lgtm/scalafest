'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/escala.controller');

const router = Router();

router.post('/enviar-dia', ctrl.enviarEscalaDia);
router.get('/envios',      ctrl.listarEnvios);

module.exports = router;
