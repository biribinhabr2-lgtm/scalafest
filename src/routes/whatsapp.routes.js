'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/whatsapp.controller');

const router = Router();

router.post('/conectar',     ctrl.conectar);
router.get('/status',        ctrl.getStatus);
router.get('/qr',            ctrl.getQR);
router.get('/grupos',        ctrl.getGrupos);
router.post('/desconectar',  ctrl.desconectar);

module.exports = router;
