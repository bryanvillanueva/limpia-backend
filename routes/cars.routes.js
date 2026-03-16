const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/cars.controller');

const adminManager = roleGuard(['admin', 'manager']);
const adminOnly = roleGuard(['admin']);

router.get('/', auth, adminManager, ctrl.getAll);
router.get('/:id/services', auth, adminManager, ctrl.getServicesByCar);
router.get('/:id', auth, adminManager, ctrl.getById);
router.post('/', auth, adminOnly, ctrl.create);
router.post('/:id/services', auth, adminOnly, ctrl.createService);
router.put('/:id', auth, adminOnly, ctrl.update);

module.exports = router;
