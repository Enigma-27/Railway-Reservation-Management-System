const express = require('express');
const {
  searchTrains,
  getTrainById,
  getTrainAvailability,
  listPublicTrains
} = require('../controllers/trainController');

const { authenticate } = require('../middleware/auth');
const { getRunStatus } = require('../controllers/publicInfoController');
const { getTrainLiveStatus } = require('../services/liveStatusService');

const router = express.Router();

router.get('/', listPublicTrains);
router.get('/search', searchTrains);
router.get('/:trainId/live-status', authenticate, async (req, res, next) => {
  try {
    const { trainId } = req.params;
    const status = await getTrainLiveStatus(trainId);
    return res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
});
// Public run status for the Track your train card (no live GPS)
router.get('/:trainId/run-status', getRunStatus);
router.get('/:trainId', getTrainById);
router.get('/:trainId/availability', getTrainAvailability);

module.exports = router;
