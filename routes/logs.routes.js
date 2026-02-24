const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/logs.controller');

const readRoles = roleGuard(['admin', 'manager', 'accountant']);
const cleanerOnly = roleGuard(['cleaner']);
const cleanerManager = roleGuard(['cleaner', 'manager']);

// /today must be before /:id to avoid route conflict
router.get('/today', auth, cleanerOnly, ctrl.getToday);
router.get('/', auth, readRoles, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);
router.post('/', auth, cleanerOnly, ctrl.create);
router.put('/:id', auth, cleanerManager, ctrl.update);

module.exports = router;
