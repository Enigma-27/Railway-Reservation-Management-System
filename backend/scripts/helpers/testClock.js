/**
 * Test clock for the old API suites (test-d2 ... test-d3c3).
 *
 * The seed is a frozen snapshot "as of 2026-10-17 19:15" with runs on 18 to 24 October 2026. The SQL tests
 * pin the clock with @as_of_time. These API suites go through the Express app and the MySQL pool, where many
 * queries use NOW() directly, so here the clock is pinned for every MySQL connection with SET timestamp:
 * NOW(), CURDATE() and COALESCE(@as_of_time, NOW()) all give the seed time.
 *
 * Require this file BEFORE the app is started (it only touches the shared pool). It changes the clock only;
 * no assertion is changed by it. The time stands still, so tests that need time to pass change created_at
 * in the database instead (as they already did).
 */
const pool = require('../../src/config/mysql');

const PINNED_NOW = process.env.TEST_AS_OF || '2026-10-17 19:15:00';

pool.pool.on('connection', (conn) => {
  conn.query(`SET timestamp = UNIX_TIMESTAMP('${PINNED_NOW}')`);
});

module.exports = { PINNED_NOW };
