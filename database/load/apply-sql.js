/**
 * Apply SQL files to railway_db WITHOUT dropping tables or reloading data.
 * File: database/load/apply-sql.js
 *
 * Use it after you change functions, procedures, triggers or tests:
 *   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers
 *   node database/load/apply-sql.js 02_functions 03_procedures 04_triggers 07_tests --run-tests
 *
 * Names can be written with or without ".sql". Only these files are allowed
 * (they only create or replace functions, procedures, triggers, views and test objects):
 *   02_functions, 03_procedures, 04_triggers, 05_views, 07_tests
 * and the optional PBL name aliases (see docs/PBL_NAME_MAPPING.md): 08_pdf_aliases, 08_pdf_aliases_drop
 *
 * --run-tests  installs 07_tests (if not listed), runs CALL sp_run_all_tests(),
 *              prints the results, then drops the test procedures and test_results table.
 * --keep-tests keeps the test objects after running (same idea as run-all.js --with-tests).
 *
 * The script reads database/.env for the connection. It never prints any env value.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DB_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  multipleStatements: true,
  dateStrings: true
};

const ALLOWED = ['02_functions', '03_procedures', '04_triggers', '05_views', '07_tests', '08_pdf_aliases', '08_pdf_aliases_drop'];

// Same DELIMITER handling as run-all.js
async function executeSqlFile(connection, filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const statements = [];
  let currentDelimiter = ';';
  let buffer = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith('DELIMITER ')) {
      currentDelimiter = trimmed.substring(10).trim();
      continue;
    }
    buffer += line + '\n';
    if (trimmed.endsWith(currentDelimiter)) {
      let stmt = buffer.trim();
      if (stmt.endsWith(currentDelimiter)) stmt = stmt.slice(0, -currentDelimiter.length).trim();
      if (stmt.length > 0) statements.push(stmt);
      buffer = '';
    }
  }
  if (buffer.trim().length > 0) statements.push(buffer.trim());

  for (const stmt of statements) {
    await connection.query(stmt);
  }
  return statements.length;
}

async function dropTestObjects(connection) {
  await connection.query('DROP TABLE IF EXISTS test_results;');
  const [procs] = await connection.query(
    `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = 'railway_db' AND ROUTINE_TYPE = 'PROCEDURE'
       AND (ROUTINE_NAME LIKE 'test\\_%' OR ROUTINE_NAME = 'sp_run_all_tests')`
  );
  for (const row of procs) {
    await connection.query(`DROP PROCEDURE IF EXISTS \`${row.ROUTINE_NAME}\``);
  }
  return procs.length;
}

async function run() {
  const args = process.argv.slice(2);
  const runTests = args.includes('--run-tests');
  const keepTests = args.includes('--keep-tests');
  const names = args
    .filter(a => !a.startsWith('--'))
    .map(a => a.replace(/\.sql$/i, '').replace(/^.*[\\/]/, ''));

  if (runTests && !names.includes('07_tests')) names.push('07_tests');

  if (names.length === 0) {
    console.error('Usage: node database/load/apply-sql.js <02_functions|03_procedures|04_triggers|05_views|07_tests> ... [--run-tests] [--keep-tests]');
    process.exit(1);
  }
  const bad = names.filter(n => !ALLOWED.includes(n));
  if (bad.length) {
    console.error(`Not allowed: ${bad.join(', ')}. Allowed: ${ALLOWED.join(', ')}`);
    process.exit(1);
  }
  // Always apply in dependency order
  names.sort((a, b) => ALLOWED.indexOf(a) - ALLOWED.indexOf(b));

  let connection;
  let failed = false;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    await connection.query('USE railway_db;');
    console.log('Connected to railway_db (no tables dropped, no data reloaded).');

    for (const name of names) {
      const count = await executeSqlFile(connection, path.resolve(__dirname, `../mysql/${name}.sql`));
      console.log(`Applied ${name}.sql (${count} statements)`);
    }

    if (runTests) {
      console.log('\nRunning CALL sp_run_all_tests() ...');
      const [outputs] = await connection.query('CALL sp_run_all_tests();');
      let rows = [];
      for (const resSet of Array.isArray(outputs) ? outputs : []) {
        if (Array.isArray(resSet) && resSet.length > 0 && resSet[0].test_id !== undefined) rows = resSet;
      }
      if (rows.length === 0) {
        console.log('No test rows came back.');
        failed = true;
      } else {
        console.table(rows);
        const passed = rows.filter(r => String(r.status || r.result || '').toUpperCase().startsWith('PASS')).length;
        console.log(`\nTEST SUMMARY: ${passed} passed, ${rows.length - passed} not passed, ${rows.length} total`);
        if (passed !== rows.length) failed = true;
      }
    }
  } catch (err) {
    console.error('[ERROR]:', err.message);
    if (err.sql) console.error('SQL:', err.sql.slice(0, 200));
    failed = true;
  } finally {
    if (connection) {
      if (runTests && !keepTests) {
        try {
          const n = await dropTestObjects(connection);
          console.log(`Dropped ${n} test procedures and the test_results table.`);
        } catch (e) {
          console.error('Warning: test cleanup failed:', e.message);
        }
      }
      await connection.end();
    }
  }
  process.exit(failed ? 1 : 0);
}

run();
