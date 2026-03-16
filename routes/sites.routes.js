const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const uploadSpreadsheet = require('../middleware/uploadSpreadsheet');
const ctrl = require('../controllers/sites.controller');

const listRoles = roleGuard(['admin', 'manager', 'accountant']);
const adminOnly = roleGuard(['admin']);

router.get('/', auth, listRoles, ctrl.getAll);
router.get('/my-sites', auth, ctrl.getMySites);
router.get('/:id/assignments', auth, ctrl.getAssignments);
router.get('/:id/comments', auth, ctrl.getComments);
router.get('/:id/logs', auth, listRoles, ctrl.getLogs);
router.get('/:id', auth, ctrl.getById);
router.post('/', auth, adminOnly, ctrl.create);
router.post('/import', auth, adminOnly, uploadSpreadsheet.single('file'), ctrl.importSites);
router.put('/:id', auth, adminOnly, ctrl.update);
router.delete('/:id', auth, adminOnly, ctrl.deactivate);
router.post('/:id/assign', auth, adminOnly, ctrl.assignTeam);
router.post('/:id/comments', auth, ctrl.addComment);

module.exports = router;
