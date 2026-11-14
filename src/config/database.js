// The single SQLite connection (Node's built-in SQLite, so no npm install is needed).
// All money values are stored as integer cents to avoid rounding errors.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./environment');
const { migrate } = require('../models/schema');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'shop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
migrate(db);

// Runs fn inside a transaction, rolling back on any thrown error.
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function closeDatabase() {
  try {
    db.close();
  } catch {
    // already closed
  }
}

module.exports = { db, transaction, closeDatabase };
