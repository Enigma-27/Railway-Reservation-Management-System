const { MongoClient } = require('mongodb');
const config = require('./env');
const AppError = require('../utils/appError');

/**
 * MongoDB is OPTIONAL. MySQL is the source of truth for bookings, payments, orders and refunds.
 * Mongo only holds notifications, complaints, activity logs, live train status and raw gateway
 * replies (audit). When Mongo is down:
 *  - Mongo-only features (notifications list, complaints, activity log list) answer 503 "MongoDB unavailable".
 *  - best-effort writes (activity logs, notification on events, raw gateway replies) log and carry on.
 *  - payments, booking, cancel and refunds keep working.
 */

let client = null;
let db = null;
let lastFailAt = 0;
let reconnectTimer = null;

// Do not wait 30 seconds for a server that is down: fail fast.
const CLIENT_OPTIONS = { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 };
// After a failed connect, later calls fail at once for a short time instead of waiting again.
const COOLDOWN_MS = 10000;

async function connectMongo() {
  if (db) return db;
  const candidate = new MongoClient(config.MONGODB_URI, CLIENT_OPTIONS);
  try {
    await candidate.connect();
    client = candidate;
    db = client.db(config.MONGODB_DB_NAME);
    lastFailAt = 0;
    return db;
  } catch (error) {
    lastFailAt = Date.now();
    try { await candidate.close(); } catch (_) { /* ignore */ }
    console.error('Failed to connect to MongoDB:', error.message);
    throw error;
  }
}

function getMongoDb() {
  return db;
}

function getMongoClient() {
  return client;
}

async function closeMongo() {
  stopMongoReconnectLoop();
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/**
 * For Mongo-only features: returns the database or throws a clear 503.
 */
async function getOrConnectMongoDb() {
  if (db) return db;
  if (lastFailAt && Date.now() - lastFailAt < COOLDOWN_MS) {
    throw new AppError('SERVICE_UNAVAILABLE', 'MongoDB unavailable', 503);
  }
  try {
    return await connectMongo();
  } catch (_) {
    throw new AppError('SERVICE_UNAVAILABLE', 'MongoDB unavailable', 503);
  }
}

/**
 * Best-effort insert (raw gateway replies and similar audit copies).
 * Never throws and never waits for the caller: returns true if saved, false if not.
 */
async function safeMongoInsert(collectionName, doc) {
  try {
    const current = getMongoDb();
    if (!current) return false;
    await current.collection(collectionName).insertOne({ ...doc, createdAt: doc.createdAt || new Date() });
    return true;
  } catch (err) {
    console.warn(`[MongoDB] Best-effort write to ${collectionName} skipped: ${err.message}`);
    return false;
  }
}

/**
 * Keep trying to connect in the background (every intervalMs) until it works.
 */
function startMongoReconnectLoop(intervalMs = 30000) {
  if (reconnectTimer || db) return;
  reconnectTimer = setInterval(async () => {
    try {
      await connectMongo();
      console.log('MongoDB connected (background retry).');
      stopMongoReconnectLoop();
    } catch (_) {
      // connectMongo already logged the reason; keep trying
    }
  }, intervalMs);
  if (reconnectTimer.unref) reconnectTimer.unref();
}

function stopMongoReconnectLoop() {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

module.exports = {
  connectMongo,
  getMongoDb,
  getOrConnectMongoDb,
  getMongoClient,
  closeMongo,
  safeMongoInsert,
  startMongoReconnectLoop,
  stopMongoReconnectLoop
};
