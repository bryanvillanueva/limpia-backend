const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

router.post('/login', ctrl.login);
router.post('/logout', auth, ctrl.logout);

// Self-service profile (any authenticated role)
router.get('/me', auth, ctrl.getMe);
router.put('/me', auth, ctrl.updateMe);
router.put('/password', auth, ctrl.changePassword);

module.exports = router;
