const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePassengerRole } = require('../controllers/tdrController');
const {
  listSavedPassengers,
  createSavedPassenger,
  updateSavedPassenger,
  deleteSavedPassenger
} = require('../controllers/savedPassengerController');

const router = express.Router();

// All saved-passenger routes need a logged-in PASSENGER; ownership is checked per row in the controller
router.use(authenticate, requirePassengerRole);

// GET /api/saved-passengers - own saved passengers
router.get('/', listSavedPassengers);

// POST /api/saved-passengers - add one
router.post('/', createSavedPassenger);

// PUT /api/saved-passengers/:id - edit own
router.put('/:id', updateSavedPassenger);

// DELETE /api/saved-passengers/:id - delete own (409 if used by a booking)
router.delete('/:id', deleteSavedPassenger);

module.exports = router;
