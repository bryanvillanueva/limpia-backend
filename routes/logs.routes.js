const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/logs.controller');

const readRoles = roleGuard(['admin', 'manager', 'accountant']);
const cleanerOnly = roleGuard(['cleaner']);
const cleanerManager = roleGuard(['cleaner', 'manager']);

// Static paths must be before /:id to avoid route conflict
router.get('/today', auth, cleanerOnly, ctrl.getToday);
router.get('/my-logs', auth, cleanerOnly, ctrl.getMyLogs);
router.get('/team', auth, cleanerOnly, ctrl.getTeamLogs);
router.get('/import-preview', auth, cleanerOnly, ctrl.getImportPreview);
router.get('/', auth, readRoles, ctrl.getAll);
router.get('/:id', auth, ctrl.getById);
router.post('/', auth, cleanerOnly, ctrl.create);
router.post('/import-from-teammate', auth, cleanerOnly, ctrl.importFromTeammate);
router.put('/:id', auth, cleanerManager, ctrl.update);
router.delete('/:id', auth, cleanerManager, ctrl.remove);

module.exports = router;
