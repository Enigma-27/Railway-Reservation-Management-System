/**
 * Route-vs-contract comparison.   Run: node scripts/check-routes.js     (npm run check:routes)
 * Lists every route the Express app really serves and every route written in the table of docs/API_CONTRACT.md, and prints
 * what exists in only one of them. Exit code 1 when a served route is missing from the contract or the contract lists a route that
 * does not exist. Path parameter names are ignored (/:pnr and /:id are the same route).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const app = require('../src/app');

function norm(p) {
  return p.replace(/:[A-Za-z0-9_]+/g, ':p').replace(/\/+$/, '') || '/';
}

function walk(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.add(`${m.toUpperCase()} ${norm(prefix + layer.route.path)}`);
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const src = layer.regexp && layer.regexp.source;
      let seg = '';
      if (src && src !== '^\\/?(?=\\/|$)') {
        seg = src.replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, ':p');
        seg = seg.replace(/\$$/, '');
      }
      walk(layer.handle.stack, prefix + seg, out);
    }
  }
}

const served = new Set();
walk(app._router.stack, '', served);
// only API routes (the static pay-test page and the like are not part of the contract)
const servedApi = new Set([...served].filter((r) => r.split(' ')[1].startsWith('/api')));

const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/API_CONTRACT.md'), 'utf8');
const documented = new Set();
for (const m of doc.matchAll(/\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`/g)) documented.add(`${m[1]} ${norm(m[2].split('?')[0])}`);

const missingInDoc = [...servedApi].filter((r) => !documented.has(r)).sort();
const missingInCode = [...documented].filter((r) => !served.has(r)).sort();
console.log(`Routes served: ${servedApi.size}   Routes in the contract table: ${documented.size}`);
console.log(`Served but NOT in the contract table (${missingInDoc.length}):`);
missingInDoc.forEach((r) => console.log('   ' + r));
console.log(`In the contract table but NOT served (${missingInCode.length}):`);
missingInCode.forEach((r) => console.log('   ' + r));
process.exitCode = missingInDoc.length || missingInCode.length ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 200);
