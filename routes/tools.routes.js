const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/tools.controller');

const adminManager = roleGuard(['admin', 'manager']);
const adminOnly = roleGuard(['admin']);

router.get('/', auth, adminManager, ctrl.getAll);
router.get('/:id', auth, adminManager, ctrl.getById);
router.post('/', auth, adminManager, ctrl.create);
router.put('/:id', auth, adminManager, ctrl.update);
router.delete('/:id', auth, adminOnly, ctrl.remove);

module.exports = router;
