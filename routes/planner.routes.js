const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/planner.controller');

router.get('/my-team', auth, ctrl.getMyTeam);
router.get('/:teamId/sites', auth, ctrl.getTeamSites);
router.get('/:teamId/:cycleWeek', auth, ctrl.getWeekPlan);
router.post('/item', auth, ctrl.createItem);
router.patch('/item/:itemId', auth, ctrl.updateItem);
router.patch('/plan/:planId', auth, ctrl.updatePlan);
router.delete('/item/:itemId', auth, ctrl.deleteItem);

module.exports = router;
