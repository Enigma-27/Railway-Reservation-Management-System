const { retryDueRefunds } = require('./gatewayRefundService');

let timer = null;
let running = false;

/**
 * One timer tick: retry REFUND rows that are PENDING or FAILED, older than 5 minutes, with fewer than 3 attempts.
 * Database locks (see retryDueRefunds) stop two overlapping runs from refunding the same row twice.
 * Errors are logged and never crash the timer.
 */
async function runRefundRetry() {
  if (running) return null; // this process is still busy with the last tick
  running = true;
  try {
    const result = await retryDueRefunds({ minAgeMinutes: 5, maxAttempts: 3 });
    if (!result.skipped && result.attempted > 0) {
      const done = result.results.filter(r => r.refundStatus === 'PROCESSED').length;
      console.log(`Refund retry: ${result.attempted} tried, ${done} now PROCESSED`);
    }
    return result;
  } catch (err) {
    console.error('Error in refund retry timer:', err.message);
    return null;
  } finally {
    running = false;
  }
}

function startRefundRetryTimer(intervalMs = 60000) {
  if (timer) return timer;
  timer = setInterval(runRefundRetry, intervalMs);
  return timer;
}

function stopRefundRetryTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { runRefundRetry, startRefundRetryTimer, stopRefundRetryTimer };
