const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/teams.controller');

const adminManager = roleGuard(['admin', 'manager']);
const adminOnly = roleGuard(['admin']);

router.get('/', auth, adminManager, ctrl.getAll);
router.get('/:id', auth, adminManager, ctrl.getById);
router.post('/', auth, adminOnly, ctrl.create);
router.put('/:id', auth, adminOnly, ctrl.update);
router.post('/:id/members', auth, adminOnly, ctrl.addMember);
router.delete('/:id/members/:userId', auth, adminOnly, ctrl.removeMember);

module.exports = router;
