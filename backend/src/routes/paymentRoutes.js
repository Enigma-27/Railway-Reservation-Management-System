const express = require('express');
const { createOrder, verifyPayment, reconcilePayment } = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Razorpay payment endpoints
router.post('/razorpay/order', authenticate, createOrder);
router.post('/razorpay/verify', authenticate, verifyPayment);
// Ask Razorpay what happened to the orders of a PNR and finish any that were paid (PASSENGER owner only)
router.post('/razorpay/reconcile', authenticate, reconcilePayment);
// The webhook (POST /razorpay/webhook) is mounted in app.js before express.json(): it needs the raw body.

module.exports = router;
