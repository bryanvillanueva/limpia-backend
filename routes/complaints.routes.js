const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/complaints.controller');

const adminManager = roleGuard(['admin', 'manager']);

router.get('/', auth, adminManager, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);
router.post('/', auth, ctrl.create);
router.put('/:id', auth, adminManager, ctrl.update);

module.exports = router;
