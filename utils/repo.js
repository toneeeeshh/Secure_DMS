const crypto = require('crypto');
const { load, save } = require('./db');

const GENESIS_HASH = '0'.repeat(64);

/* ---------------- Users ---------------- */

const users = {
  count: () => load().users.length,

  findByUsername: (username) => {
    const u = load().users.find(u => u.username === username);
    if (!u) return null;
    return { ...u, password_hash: u.passwordHash };
  },

  all: () =>
    load().users
      .map(u => ({ username: u.username, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),

  create: ({ username, passwordHash, role, name, createdAt }) => {
    const data = load();
    data.users.push({ username, passwordHash, role, name, active: true, createdAt });
    save(data);
  },

  setActive: (username, active) => {
    const data = load();
    const u = data.users.find(u => u.username === username);
    if (u) u.active = !!active;
    save(data);
  },

  setRole: (username, role) => {
    const data = load();
    const u = data.users.find(u => u.username === username);
    if (u) u.role = role;
    save(data);
  }
};

/* ---------------- Cases ---------------- */

const cases = {
  create: (kase) => {
    const data = load();
    data.cases.push({ ...kase });
    save(data);
  },

  findById: (id) => load().cases.find(c => c.id === id) || null,

  all: () => load().cases.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),

  addMember: (id, username) => {
    const data = load();
    const c = data.cases.find(c => c.id === id);
    if (c && !c.members.includes(username)) c.members.push(username);
    save(data);
    return c;
  },

  removeMember: (id, username) => {
    const data = load();
    const c = data.cases.find(c => c.id === id);
    if (c) c.members = c.members.filter(m => m !== username);
    save(data);
    return c;
  }
};

/* ---------------- Documents ---------------- */

const documents = {
  create: (doc) => {
    const data = load();
    data.counters.document = (data.counters.document || 0) + 1;
    const documentCode = 'DOC-' + String(data.counters.document).padStart(6, '0');
    data.documents.push({ ...doc, documentCode, deleted: false });
    save(data);
    return documentCode;
  },

  findById: (id) => load().documents.find(d => d.id === id) || null,

  listNotDeleted: () =>
    load().documents
      .filter(d => !d.deleted)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),

  forCase: (caseId) =>
    load().documents
      .filter(d => !d.deleted && d.caseId === caseId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),

  bumpVersion: (id, newVersion) => {
    const data = load();
    const d = data.documents.find(d => d.id === id);
    if (d) d.currentVersion = newVersion;
    save(data);
  },

  softDelete: (id) => {
    const data = load();
    const d = data.documents.find(d => d.id === id);
    if (d) d.deleted = true;
    save(data);
  }
};

/* ---------------- Versions ---------------- */

const versions = {
  add: (v) => {
    const data = load();
    data.versions.push({
      document_id: v.documentId,
      version: v.version,
      stored_name: v.storedName,
      original_name: v.originalName,
      size: v.size,
      hash: v.hash,
      signature: v.signature,
      uploaded_by: v.uploadedBy,
      uploaded_at: v.uploadedAt
    });
    save(data);
  },

  forDocument: (documentId) =>
    load().versions
      .filter(v => v.document_id === documentId)
      .sort((a, b) => a.version - b.version)
      .map(v => ({
        version: v.version,
        storedName: v.stored_name,
        originalName: v.original_name,
        size: v.size,
        hash: v.hash,
        signature: v.signature,
        uploadedBy: v.uploaded_by,
        uploadedAt: v.uploaded_at
      })),

  find: (documentId, version) =>
    load().versions.find(v => v.document_id === documentId && v.version === version) || null,

  allForFilename: (needle) =>
    load().versions.filter(v => v.original_name.toLowerCase().includes(needle.toLowerCase()))
};

/* ---------------- Audit logs (hash-chained, tamper-evident) ---------------- */

function computeEntryHash(prevHash, entry) {
  const payload = [
    prevHash,
    entry.timestamp,
    entry.user,
    entry.action,
    entry.documentId || '',
    entry.caseId || '',
    entry.details || ''
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const auditLogs = {
  add: ({ user, action, documentId = null, caseId = null, details = '', ip = '' }) => {
    const data = load();
    data.counters.audit = (data.counters.audit || 0) + 1;
    const last = data.auditLogs[data.auditLogs.length - 1];
    const prevHash = last ? last.entryHash : GENESIS_HASH;

    const entry = {
      id: data.counters.audit,
      timestamp: new Date().toISOString(),
      user: user || 'anonymous',
      action,
      documentId,
      caseId,
      details,
      ip
    };
    entry.prevHash = prevHash;
    entry.entryHash = computeEntryHash(prevHash, entry);

    data.auditLogs.push(entry);
    save(data);
    return entry;
  },

  forDocument: (documentId) =>
    load().auditLogs.filter(l => l.documentId === documentId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

  forCase: (caseId) =>
    load().auditLogs.filter(l => l.caseId === caseId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

  search: ({ user, action, from, to }) => {
    let logs = load().auditLogs;
    if (user) logs = logs.filter(l => l.user.toLowerCase().includes(user.toLowerCase()));
    if (action) logs = logs.filter(l => l.action === action);
    if (from) logs = logs.filter(l => new Date(l.timestamp) >= new Date(from));
    if (to) logs = logs.filter(l => new Date(l.timestamp) <= new Date(to));
    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  alerts: (limit = 50) =>
    load().auditLogs
      .filter(l => l.action === 'ACCESS_DENIED' || l.action === 'DOCUMENT_TAMPER_DETECTED')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit),

  // Walks the entire chain from the genesis hash and recomputes every entry's
  // hash to confirm nothing has been altered, reordered, or deleted.
  verifyChain: () => {
    const logs = load().auditLogs.slice().sort((a, b) => a.id - b.id);
    let expectedPrev = GENESIS_HASH;
    for (const entry of logs) {
      if (entry.prevHash !== expectedPrev) {
        return { valid: false, brokenAtId: entry.id, reason: 'prevHash does not match the preceding entry.' };
      }
      const recomputed = computeEntryHash(entry.prevHash, entry);
      if (recomputed !== entry.entryHash) {
        return { valid: false, brokenAtId: entry.id, reason: 'Entry content does not match its stored hash — this entry was altered.' };
      }
      expectedPrev = entry.entryHash;
    }
    return { valid: true, entriesChecked: logs.length };
  }
};

module.exports = { users, cases, documents, versions, auditLogs };
