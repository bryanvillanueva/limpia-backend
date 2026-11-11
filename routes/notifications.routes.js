const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/notifications.controller');

// Every authenticated user has their own notifications, whatever their role.
// Static paths first so they are not captured by /:id.
router.get('/unread-count', auth, ctrl.unreadCount);
router.post('/read-all', auth, ctrl.markAllRead);
router.get('/', auth, ctrl.list);
router.patch('/:id/read', auth, ctrl.markRead);

module.exports = router;
