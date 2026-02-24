const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/clients.controller');

const readRoles = roleGuard(['admin', 'manager', 'accountant']);
const adminOnly = roleGuard(['admin']);

router.get('/', auth, readRoles, ctrl.getAll);
router.get('/:id', auth, readRoles, ctrl.getById);
router.post('/', auth, adminOnly, ctrl.create);
router.put('/:id', auth, adminOnly, ctrl.update);

module.exports = router;
