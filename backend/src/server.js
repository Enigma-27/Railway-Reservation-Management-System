const app = require('./app');
const config = require('./config/env');
const { connectMongo, closeMongo, startMongoReconnectLoop } = require('./config/mongodb');
const pool = require('./config/mysql');
const { startCleanupTimer, stopCleanupTimer } = require('./services/holdCleanupService');
const { startRefundRetryTimer, stopRefundRetryTimer } = require('./services/refundRetryService');
const { startReconcileTimer, stopReconcileTimer } = require('./services/reconcileService');

async function startServer() {
  try {
    // MongoDB is optional: if it is down at startup, warn and keep trying in the background.
    // Payments, bookings, cancellations and refunds work without it (MySQL is the source of truth).
    try {
      await connectMongo();
    } catch (mongoErr) {
      console.warn('MongoDB is unavailable at startup. The server will start without it and retry every 30 seconds.');
      startMongoReconnectLoop(30000);
    }

    // Start background hold cleanup timer (calls sp_release_expired_holds every 60s)
    startCleanupTimer(60000);

    // Start background refund retry timer (PENDING or FAILED refunds older than 5 minutes, fewer than 3 attempts)
    startRefundRetryTimer(60000);

    // Start background payment reconcile timer (CREATED orders older than 1 minute, newer than 24 hours, max 20 per run)
    startReconcileTimer(60000);

    const server = app.listen(config.PORT, () => {
      console.log(`Server started on port ${config.PORT}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down server gracefully...');
      stopCleanupTimer();
      stopRefundRetryTimer();
      stopReconcileTimer();
      server.close(async () => {
        try {
          await pool.end();
          await closeMongo();
          console.log('Database connections closed.');
          process.exit(0);
        } catch (err) {
          console.error('Error during shutdown:', err.message);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
