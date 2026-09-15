'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/templates.controller');

const router = Router();

router.get('/',         ctrl.listar);
router.put('/:chave',   ctrl.salvar);
router.delete('/:chave', ctrl.restaurar);

module.exports = router;
