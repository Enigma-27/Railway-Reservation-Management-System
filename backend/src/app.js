const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/auth');
const { getMe } = require('./controllers/authController');
const { razorpayWebhook } = require('./controllers/paymentController');

const path = require('path');

const app = express();

// Middleware
app.use(cors());

// Razorpay webhook: the signature is over the RAW body, so this route gets express.raw and must be
// mounted BEFORE express.json(). Every other route is unchanged.
app.post('/api/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), razorpayWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Root convenience /me route per prompt ("Register, login and GET /me")
app.get('/me', authenticate, getMe);

// API routes
app.use('/api', apiRoutes);

// Catch 404
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`
    }
  });
});

// Centralized error handling mapper
app.use(errorHandler);

module.exports = app;
