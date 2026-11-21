const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env explicitly
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Use the first variable that has a value. database/.env uses MYSQL_*, backend uses DB_*.
function firstSet(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

const config = {
  PORT: parseInt(process.env.PORT, 10) || 5000,
  DB_HOST: firstSet('DB_HOST', 'MYSQL_HOST') || 'localhost',
  DB_PORT: parseInt(firstSet('DB_PORT', 'MYSQL_PORT'), 10) || 3306,
  DB_USER: firstSet('DB_USER', 'MYSQL_USER') || 'root',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'railway_db',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/railway_db',
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'railway_db',
  JWT_SECRET: process.env.JWT_SECRET || 'default_jwt_secret',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  // Secret for the Razorpay webhook signature. Empty = webhook answers 503 (never crashes startup).
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || ''
};

// The API server must not run with a missing or well-known token secret.
// Only enforced when the entry file is server.js, so demo/test scripts that
// import this config are not affected.
const entryFile = require.main && require.main.filename ? path.basename(require.main.filename) : '';
if (entryFile === 'server.js') {
  if (!config.JWT_SECRET || config.JWT_SECRET === 'default_jwt_secret') {
    console.error('Startup refused: JWT_SECRET is missing or still the default value. Set a long random JWT_SECRET in backend/.env.');
    process.exit(1);
  }
}

module.exports = config;
