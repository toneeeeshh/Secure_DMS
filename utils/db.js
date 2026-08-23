const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'db.json');

function defaultData() {
  return {
    users: [],
    cases: [],
    documents: [],
    versions: [],
    auditLogs: [],
    counters: { audit: 0, document: 0 }
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) save(defaultData());
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    // Backfill fields for older data files created before case-management was added.
    if (!data.cases) data.cases = [];
    if (!data.counters.document) data.counters.document = 0;
    return data;
  } catch (e) {
    console.error('DB file was unreadable, reinitializing.', e);
    const fresh = defaultData();
    save(fresh);
    return fresh;
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { load, save, DB_PATH };
