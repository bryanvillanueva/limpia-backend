const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/supplies.controller');

const adminManager = roleGuard(['admin', 'manager']);
const cleanerOnly = roleGuard(['cleaner']);

router.get('/', auth, adminManager, ctrl.getAllOrders);
router.get('/:id', auth, adminManager, ctrl.getOrderById);
router.post('/', auth, cleanerOnly, ctrl.createOrder);
router.put('/:id/approve', auth, adminManager, ctrl.approveOrder);
router.put('/:id/complete', auth, adminManager, ctrl.completeOrder);
router.put('/:id/reject', auth, adminManager, ctrl.rejectOrder);

module.exports = router;
