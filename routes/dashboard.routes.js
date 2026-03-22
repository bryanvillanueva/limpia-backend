const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/dashboard.controller');

const allAuthenticatedRoles = roleGuard(['cleaner', 'manager', 'accountant', 'admin']);

router.get('/stats', auth, allAuthenticatedRoles, ctrl.getStats);

module.exports = router;
