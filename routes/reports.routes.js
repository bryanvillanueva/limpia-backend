const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/reports.controller');

const adminAccountant = roleGuard(['admin', 'accountant']);
const accountantOnly = roleGuard(['accountant']);
const cleanerAdminAccountant = roleGuard(['cleaner', 'admin', 'accountant']);
const allAuthenticatedRoles = roleGuard(['cleaner', 'manager', 'accountant', 'admin']);

router.get('/cycle', auth, allAuthenticatedRoles, ctrl.getCycle);
router.get('/period-logs', auth, cleanerAdminAccountant, ctrl.getPeriodLogs);
router.get('/my-reports', auth, cleanerAdminAccountant, ctrl.getMyReports);
router.get('/', auth, adminAccountant, ctrl.getAll);
router.get('/:id', auth, cleanerAdminAccountant, ctrl.getById);
router.post('/generate', auth, cleanerAdminAccountant, ctrl.generate);
router.put('/:id/approve', auth, accountantOnly, ctrl.approve);

module.exports = router;
