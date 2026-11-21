const { reconcileDueOrders } = require('./paymentOrderService');

let timer = null;
let running = false;

/**
 * One timer tick: reconcile CREATED payment orders older than 1 minute and newer than 24 hours
 * (max 20 per run). A database lock stops two overlapping runs. Errors are logged, never thrown.
 */
async function runReconcile() {
  if (running) return null; // this process is still busy with the last tick
  running = true;
  try {
    const result = await reconcileDueOrders({ minAgeMinutes: 1, maxAgeHours: 24, limit: 20 });
    if (!result.skipped) {
      const finished = result.results.filter(r => r.outcome === 'CONFIRMED' || r.outcome === 'LATE');
      if (finished.length > 0) {
        console.log(`Payment reconcile: ${finished.length} order(s) finished (${result.attempted} checked)`);
      }
    }
    return result;
  } catch (err) {
    console.error('Error in payment reconcile timer:', err.message);
    return null;
  } finally {
    running = false;
  }
}

function startReconcileTimer(intervalMs = 60000) {
  if (timer) return timer;
  timer = setInterval(runReconcile, intervalMs);
  return timer;
}

function stopReconcileTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { runReconcile, startReconcileTimer, stopReconcileTimer };
