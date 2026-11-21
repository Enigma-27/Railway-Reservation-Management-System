const express = require('express');
const { listLiveTrains, getLiveTrain } = require('../controllers/liveTrainsController');

const router = express.Router();

// GET /api/live-trains - public list of the runs on one date (filters in the query string)
router.get('/', listLiveTrains);
// GET /api/live-trains/:scheduleId - public detail of one run: per class and per quota
router.get('/:scheduleId', getLiveTrain);

module.exports = router;
