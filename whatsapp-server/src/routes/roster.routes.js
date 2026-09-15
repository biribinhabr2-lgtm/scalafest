'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/roster.controller');

const router = Router();

// POST /api/roster/sugerir  — sugere escala para um evento
router.post('/sugerir', ctrl.sugerir);

// POST /api/roster/confirmar — registra decisão (sugerido vs escolhido)
router.post('/confirmar', ctrl.confirmar);

module.exports = router;
