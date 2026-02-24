const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/reports.controller');

const adminAccountant = roleGuard(['admin', 'accountant']);
const accountantOnly = roleGuard(['accountant']);

router.get('/', auth, adminAccountant, ctrl.getAll);
router.get('/:id', auth, adminAccountant, ctrl.getById);
router.post('/generate', auth, adminAccountant, ctrl.generate);
router.put('/:id/approve', auth, accountantOnly, ctrl.approve);

module.exports = router;
