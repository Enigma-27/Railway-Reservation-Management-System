const { ObjectId } = require('mongodb');
const AppError = require('../utils/appError');
const { getOrConnectMongoDb } = require('../config/mongodb');

/**
 * Admin screen for the messages sent from the Contact Us panel (MongoDB collection contact_messages).
 *   GET   /api/admin/contact-messages?status=NEW|DONE   newest first
 *   PATCH /api/admin/contact-messages/:id               { "status": "DONE" | "NEW" }  mark done / reopen
 * Answers 503 "MongoDB unavailable" when MongoDB is down (the messages live only there).
 */

const STATUSES = ['NEW', 'DONE'];

function shape(doc) {
  return {
    messageId: String(doc._id),
    name: doc.name,
    email: doc.email,
    message: doc.message,
    createdAt: doc.createdAt,
    status: doc.status || 'NEW',
    handledAt: doc.handledAt || null,
    handledBy: doc.handledBy || null
  };
}

async function listContactMessages(req, res, next) {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    if (status && !STATUSES.includes(status)) {
      throw new AppError('VALIDATION_ERROR', `status must be one of ${STATUSES.join(', ')}`, 400);
    }
    const db = await getOrConnectMongoDb();
    const filter = status ? (status === 'NEW' ? { status: { $in: ['NEW', null] } } : { status }) : {};
    const docs = await db.collection('contact_messages').find(filter).sort({ _id: -1 }).limit(200).toArray();
    return res.status(200).json({ success: true, data: docs.map(shape) });
  } catch (error) {
    next(error);
  }
}

async function updateContactMessage(req, res, next) {
  try {
    const status = String((req.body && req.body.status) || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      throw new AppError('VALIDATION_ERROR', `status must be one of ${STATUSES.join(', ')}`, 400);
    }
    if (!ObjectId.isValid(req.params.id)) {
      throw new AppError('NOT_FOUND', 'Message not found', 404);
    }
    const db = await getOrConnectMongoDb();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const set = status === 'DONE'
      ? { status, handledAt: now, handledBy: req.user.email || String(req.user.userId) }
      : { status, handledAt: null, handledBy: null };
    const result = await db.collection('contact_messages').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: set },
      { returnDocument: 'after' }
    );
    const doc = result && (result.value !== undefined ? result.value : result);
    if (!doc) throw new AppError('NOT_FOUND', 'Message not found', 404);
    return res.status(200).json({ success: true, data: shape(doc) });
  } catch (error) {
    next(error);
  }
}

module.exports = { listContactMessages, updateContactMessage };
