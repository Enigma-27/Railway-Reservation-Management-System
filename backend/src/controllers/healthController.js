const pool = require('../config/mysql');
const { getMongoDb, connectMongo } = require('../config/mongodb');
const { formatIndiaDateTime } = require('../utils/dateUtils');

// Raw error text is shown only in development; otherwise a short fixed message is returned
// and the real error is logged on the server.
function safeErrorMessage(label, err) {
  console.error(`[HEALTH] ${label} check failed:`, err && err.message ? err.message : err);
  return process.env.NODE_ENV === 'development'
    ? (err && err.message ? err.message : 'Unknown error')
    : 'Service check failed';
}

async function getHealth(req, res, next) {
  const health = {
    status: 'UP',
    timestamp: formatIndiaDateTime(new Date()),
    services: {
      mysql: { status: 'UNKNOWN' },
      mongodb: { status: 'UNKNOWN' }
    }
  };

  let allHealthy = true;

  // 1. MySQL Health Check
  try {
    const [result] = await pool.query('SELECT 1 as ping');
    if (result && result.length > 0 && result[0].ping === 1) {
      health.services.mysql = {
        status: 'UP',
        database: 'connected'
      };
    } else {
      health.services.mysql = { status: 'DOWN', error: 'Unexpected ping response' };
      allHealthy = false;
    }
  } catch (err) {
    health.services.mysql = { status: 'DOWN', error: safeErrorMessage('MySQL', err) };
    allHealthy = false;
  }

  // 2. MongoDB Health Check
  try {
    let db = getMongoDb();
    if (!db) {
      db = await connectMongo();
    }
    const mongoPing = await db.command({ ping: 1 });
    if (mongoPing && mongoPing.ok === 1) {
      health.services.mongodb = {
        status: 'UP',
        database: 'connected'
      };
    } else {
      health.services.mongodb = { status: 'DOWN', error: 'Unexpected ping response' };
      allHealthy = false;
    }
  } catch (err) {
    health.services.mongodb = { status: 'DOWN', error: safeErrorMessage('MongoDB', err) };
    allHealthy = false;
  }

  health.status = allHealthy ? 'UP' : 'DEGRADED';
  const httpStatus = allHealthy ? 200 : 503;

  return res.status(httpStatus).json({
    success: allHealthy,
    data: health,
    message: allHealthy ? 'All services operating normally' : 'One or more services degraded'
  });
}

module.exports = {
  getHealth
};
