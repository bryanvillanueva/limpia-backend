const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/supplies.controller');

const adminManagerAccountant = roleGuard(['admin', 'manager', 'accountant']);
const orderCreators = roleGuard(['admin', 'manager', 'accountant', 'cleaner']);
const allRoles = roleGuard(['admin', 'manager', 'accountant', 'cleaner']);

router.get('/my-team', auth, allRoles, ctrl.getMyTeamOrders);
router.get('/', auth, adminManagerAccountant, ctrl.getAllOrders);
router.get('/:id', auth, adminManagerAccountant, ctrl.getOrderById);
router.post('/', auth, orderCreators, ctrl.createOrder);
router.put('/:id/approve', auth, adminManagerAccountant, ctrl.approveOrder);
router.put('/:id/complete', auth, adminManagerAccountant, ctrl.completeOrder);
router.put('/:id/reject', auth, adminManagerAccountant, ctrl.rejectOrder);

module.exports = router;
