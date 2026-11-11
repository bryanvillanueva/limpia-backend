const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const ctrl = require('../controllers/logShares.controller');

// Only cleaners register logs, so only cleaners share/receive them.
const cleanerOnly = roleGuard(['cleaner']);

router.get('/recipients', auth, cleanerOnly, ctrl.getRecipients);
router.post('/', auth, cleanerOnly, ctrl.create);
router.post('/:id/accept', auth, cleanerOnly, ctrl.accept);
router.post('/:id/reject', auth, cleanerOnly, ctrl.reject);
router.post('/:id/cancel', auth, cleanerOnly, ctrl.cancel);

module.exports = router;
