const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/vacations.controller');

const adminManager = roleGuard(['admin', 'manager']);
const adminOnly = roleGuard(['admin']);
const cleanerOnly = roleGuard(['cleaner']);

// /mine must be before /:id
router.get('/mine', auth, cleanerOnly, ctrl.getMine);
router.get('/', auth, adminManager, ctrl.getAll);
router.post('/', auth, cleanerOnly, ctrl.create);
router.put('/:id/approve', auth, adminOnly, ctrl.approve);
router.put('/:id/reject', auth, adminOnly, ctrl.reject);

module.exports = router;
