const express = require('express');
const { getAlerts, submitContact, getContactInfo } = require('../controllers/publicInfoController');
const { getPublicPnrStatus, rateLimit } = require('../controllers/publicPnrController');
const { bookingRules } = require('../controllers/bookingPreviewController');

const router = express.Router();

// GET /api/alerts - public service alerts (delayed or cancelled runs of the next 7 days)
router.get('/alerts', getAlerts);

// GET /api/booking-rules - public: passenger limits, senior ages, Tatkal rules and the concession list (from the database)
router.get('/booking-rules', bookingRules);

// GET /api/contact-info - public: helpline, e-mail and address for the Contact Us panel (SETTING)
router.get('/contact-info', getContactInfo);

// GET /api/pnr-status/:pnr - public: status only of a 10-digit PNR (no names, ages, IDs, contact data), rate limited
router.get('/pnr-status/:pnr', rateLimit, getPublicPnrStatus);

// POST /api/contact - public Contact Us message (saved in MongoDB)
router.post('/contact', submitContact);

module.exports = router;
