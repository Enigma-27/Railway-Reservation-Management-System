/**
 * Demo clear: removes ALL bookings and everything that hangs off them, and puts the seat counters back to "empty".
 * File: backend/scripts/demo-clear.js        Run: npm run demo:clear
 *
 * *** THIS COMMAND CHANGES (DELETES) DATA. It is safe to run again and again. ***
 *
 * Removes (MySQL): REFUND, CHART_SNAPSHOT, SEAT_HOLD, TICKET_VERIFICATION, TDR_FILING, CANCELLATION, PAYMENT, PAYMENT_ORDER,
 *                  RESERVATION, PASSENGER_BOOKING, BOOKING. The order follows the foreign keys (children first), no checks are switched off.
 * Resets (MySQL):  SCHEDULE_CLASS_INVENTORY (available_seats = total_seats, rac_count = 0, wl_count = 0) and
 *                  TRAIN_SCHEDULE.chart_prepared_at = NULL (a prepared chart without a snapshot would lock the run for nothing).
 * Removes (MongoDB): booking notifications (every notification that points to a 10-digit PNR, and the booking notification types)
 *                  and the raw payment gateway replies.
 * Keeps: users, saved passengers, staff, admins, trains, routes, schedules (and their delays), stations, fares, rules, settings,
 *        fines, incidents, reports, complaints, contact messages, audit logs, activity logs.
 *
 * After the delete it runs the master inventory audit and stops with an error if it is not 0 mismatches.
 * Afterwards run: npm run demo:chain   (rebuilds the RAC / waiting list chain under chain@rrms.in)
 */
const pool = require('../src/config/mysql');
const { getOrConnectMongoDb } = require('../src/config/mongodb');
const { auditInventory } = require('./helpers/simulationHelper');

const ORDER = ['REFUND', 'CHART_SNAPSHOT', 'SEAT_HOLD', 'TICKET_VERIFICATION', 'TDR_FILING', 'CANCELLATION', 'PAYMENT', 'PAYMENT_ORDER', 'RESERVATION', 'PASSENGER_BOOKING', 'BOOKING'];

async function main() {
  const conn = await pool.getConnection();
  const removed = {};
  try {
    await conn.beginTransaction();
    for (const table of ORDER) {
      const [r] = await conn.query(`DELETE FROM ${table}`);
      removed[table] = r.affectedRows;
    }
    const [inv] = await conn.query('UPDATE SCHEDULE_CLASS_INVENTORY SET available_seats = total_seats, rac_count = 0, wl_count = 0');
    const [sch] = await conn.query('UPDATE TRAIN_SCHEDULE SET chart_prepared_at = NULL WHERE chart_prepared_at IS NOT NULL');
    await conn.commit();
    removed._inventoryRowsReset = inv.affectedRows;
    removed._chartLocksCleared = sch.affectedRows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // MongoDB (optional: skipped quietly when MongoDB is down)
  let mongo = 'skipped (MongoDB not available)';
  try {
    const db = await getOrConnectMongoDb();
    if (db) {
      const n = await db.collection('notifications').deleteMany({
        $or: [{ reference_id: { $regex: '^[0-9]{10}$' } }, { referenceId: { $regex: '^[0-9]{10}$' } }, { type: { $in: ['BOOKING_CONFIRMATION', 'STATUS_UPDATE', 'CANCELLATION'] } }],
      });
      const g = await db.collection('raw_gateway_replies').deleteMany({});
      mongo = `${n.deletedCount} booking notifications, ${g.deletedCount} gateway replies removed`;
    }
  } catch (e) {
    mongo = `skipped (${e.message})`;
  }

  const audit = await auditInventory(pool);
  const [[left]] = await pool.query('SELECT (SELECT COUNT(*) FROM BOOKING) AS bookings, (SELECT COUNT(*) FROM RESERVATION) AS reservations, (SELECT COUNT(*) FROM PAYMENT) AS payments');
  console.log('================================================================================');
  console.log(' DEMO CLEAR (all bookings removed)');
  console.log('================================================================================');
  Object.entries(removed).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v}`));
  console.log(`  MongoDB                ${mongo}`);
  console.log(`  Left: ${left.bookings} bookings, ${left.reservations} reservations, ${left.payments} payments`);
  console.log(`  Inventory audit: ${audit.totalInventories} inventories, ${audit.mismatches} mismatches`);
  console.log('================================================================================');
  if (audit.mismatches > 0 || Number(left.bookings) !== 0) {
    console.error('[demo:clear] FAILED: counters or bookings are not clean', JSON.stringify(audit.mismatchDetails || [], null, 1));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((e) => { console.error('[demo:clear] ERROR:', e.message); process.exitCode = 1; })
    .finally(async () => {
      await pool.end().catch(() => {});
      // the MongoDB client keeps the process alive: leave explicitly
      process.exit(process.exitCode || 0);
    });
}
module.exports = { main };
