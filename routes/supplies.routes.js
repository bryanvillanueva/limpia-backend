const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/supplies.controller');

const adminManager = roleGuard(['admin', 'manager']);

router.get('/', auth, ctrl.getAll);
router.post('/', auth, adminManager, ctrl.create);
router.put('/:id', auth, adminManager, ctrl.update);

module.exports = router;
