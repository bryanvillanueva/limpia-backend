const router = require('express').Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const uploadImage = require('../middleware/uploadImage');
const ctrl = require('../controllers/supplies.controller');

const adminManager = roleGuard(['admin', 'manager']);

router.get('/', auth, ctrl.getAll);
router.post('/upload-image', auth, adminManager, uploadImage.single('image'), ctrl.uploadSupplyImage);
router.post('/', auth, adminManager, uploadImage.single('image'), ctrl.create);
router.put('/:id', auth, adminManager, uploadImage.single('image'), ctrl.update);

module.exports = router;
