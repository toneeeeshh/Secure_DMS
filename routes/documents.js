const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { documents, versions, cases, auditLogs } = require('../utils/repo');
const { hashBuffer, signHash, verifySignature } = require('../utils/security');
const { verifyToken, requireRole } = require('../middleware/auth');
const { canAccessCase, canUploadToCase } = require('../utils/roles');

const router = express.Router();
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.use(verifyToken);

function publicDoc(doc) {
  return {
    id: doc.id,
    documentCode: doc.documentCode,
    caseId: doc.caseId,
    title: doc.title,
    type: doc.type,
    tags: doc.tags,
    description: doc.description,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
    currentVersion: doc.currentVersion,
    deleted: doc.deleted,
    versions: versions.forDocument(doc.id).map(v => ({
      version: v.version,
      originalName: v.originalName,
      size: v.size,
      hash: v.hash,
      uploadedBy: v.uploadedBy,
      uploadedAt: v.uploadedAt
    }))
  };
}

function loadCaseOr404(caseId, res) {
  const kase = cases.findById(caseId);
  if (!kase) { res.status(404).json({ error: 'Case not found.' }); return null; }
  return kase;
}

// Create a new document inside a case.
router.post('/', upload.single('file'), (req, res) => {
  const { caseId, title, type, tags, description } = req.body;
  if (!caseId || !title || !type || !req.file) {
    return res.status(400).json({ error: 'Case, title, document type, and a file are required.' });
  }

  const kase = loadCaseOr404(caseId, res);
  if (!kase) return;

  if (!canUploadToCase(req.user, kase)) {
    auditLogs.add({ user: req.user.username, action: 'ACCESS_DENIED', caseId, details: 'Attempted document upload.', ip: req.ip });
    return res.status(403).json({ error: 'You do not have permission to upload documents to this case.' });
  }

  const docId = uuidv4();
  const docDir = path.join(UPLOAD_ROOT, docId);
  fs.mkdirSync(docDir, { recursive: true });

  const hash = hashBuffer(req.file.buffer);
  const signature = signHash(hash);
  const storedName = `v1__${req.file.originalname}`;
  fs.writeFileSync(path.join(docDir, storedName), req.file.buffer);

  const createdAt = new Date().toISOString();

  const documentCode = documents.create({
    id: docId,
    caseId,
    title,
    type,
    tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean),
    description: description || '',
    uploadedBy: req.user.username,
    createdAt,
    currentVersion: 1
  });

  versions.add({
    documentId: docId, version: 1, storedName, originalName: req.file.originalname,
    size: req.file.size, hash, signature, uploadedBy: req.user.username, uploadedAt: createdAt
  });

  auditLogs.add({
    user: req.user.username, action: 'DOCUMENT_UPLOADED', documentId: docId, caseId,
    details: `Uploaded "${title}" (${documentCode}) to case ${kase.caseNumber}.`, ip: req.ip
  });

  res.json({ message: `Document ${documentCode} created and secured.`, document: publicDoc(documents.findById(docId)) });
});

// Search documents across cases the user can access.
router.get('/', (req, res) => {
  const { q, documentId, fileName, type } = req.query;
  let docs = documents.listNotDeleted().filter(d => canAccessCase(req.user, cases.findById(d.caseId)));

  if (type) docs = docs.filter(d => d.type.toLowerCase() === type.toLowerCase());
  if (documentId) docs = docs.filter(d => d.documentCode.toLowerCase().includes(documentId.toLowerCase()) || d.id === documentId);
  if (fileName) {
    const matches = versions.allForFilename(fileName).map(v => v.document_id);
    docs = docs.filter(d => matches.includes(d.id));
  }
  if (q) {
    const needle = q.toLowerCase();
    docs = docs.filter(d =>
      d.title.toLowerCase().includes(needle) ||
      d.documentCode.toLowerCase().includes(needle) ||
      d.description.toLowerCase().includes(needle) ||
      d.tags.some(t => t.toLowerCase().includes(needle))
    );
  }

  res.json({ documents: docs.map(publicDoc) });
});

router.get('/:id', (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc || doc.deleted) return res.status(404).json({ error: 'Document not found.' });
  const kase = cases.findById(doc.caseId);

  if (!canAccessCase(req.user, kase)) {
    auditLogs.add({ user: req.user.username, action: 'ACCESS_DENIED', documentId: doc.id, caseId: doc.caseId, ip: req.ip });
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  auditLogs.add({ user: req.user.username, action: 'DOCUMENT_VIEWED', documentId: doc.id, caseId: doc.caseId, ip: req.ip });
  res.json({ document: publicDoc(doc), case: { id: kase.id, caseNumber: kase.caseNumber, title: kase.title } });
});

router.post('/:id/versions', upload.single('file'), (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc || doc.deleted) return res.status(404).json({ error: 'Document not found.' });
  const kase = cases.findById(doc.caseId);

  if (!canUploadToCase(req.user, kase)) {
    auditLogs.add({ user: req.user.username, action: 'ACCESS_DENIED', documentId: doc.id, caseId: doc.caseId, details: 'Attempted new version upload.', ip: req.ip });
    return res.status(403).json({ error: 'You do not have permission to add a version to this document.' });
  }
  if (!req.file) return res.status(400).json({ error: 'A file is required.' });

  const nextVersion = doc.currentVersion + 1;
  const docDir = path.join(UPLOAD_ROOT, doc.id);
  const hash = hashBuffer(req.file.buffer);
  const signature = signHash(hash);
  const storedName = `v${nextVersion}__${req.file.originalname}`;
  fs.writeFileSync(path.join(docDir, storedName), req.file.buffer);

  versions.add({
    documentId: doc.id, version: nextVersion, storedName, originalName: req.file.originalname,
    size: req.file.size, hash, signature, uploadedBy: req.user.username, uploadedAt: new Date().toISOString()
  });
  documents.bumpVersion(doc.id, nextVersion);

  auditLogs.add({
    user: req.user.username, action: 'DOCUMENT_UPLOADED', documentId: doc.id, caseId: doc.caseId,
    details: `Uploaded version ${nextVersion}.`, ip: req.ip
  });
  res.json({ message: `Version ${nextVersion} added.`, document: publicDoc(documents.findById(doc.id)) });
});

// Verify integrity: recompute hash + check signature against the real stored file.
router.get('/:id/versions/:version/verify', (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc || doc.deleted) return res.status(404).json({ error: 'Document not found.' });
  const kase = cases.findById(doc.caseId);
  if (!canAccessCase(req.user, kase)) return res.status(403).json({ error: 'Access denied.' });

  const v = versions.find(doc.id, Number(req.params.version));
  if (!v) return res.status(404).json({ error: 'Version not found.' });

  const filePath = path.join(UPLOAD_ROOT, doc.id, v.stored_name);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'Stored file is missing from disk.' });

  const currentHash = hashBuffer(fs.readFileSync(filePath));
  const hashMatches = currentHash === v.hash;
  const signatureValid = verifySignature(v.hash, v.signature);
  const verified = hashMatches && signatureValid;

  auditLogs.add({
    user: req.user.username, action: 'DOCUMENT_VERIFIED', documentId: doc.id, caseId: doc.caseId,
    details: `Version ${v.version}: ${verified ? 'VERIFIED' : 'INTEGRITY COMPROMISED'}.`, ip: req.ip
  });
  if (!verified) {
    auditLogs.add({
      user: req.user.username, action: 'DOCUMENT_TAMPER_DETECTED', documentId: doc.id, caseId: doc.caseId,
      details: `Version ${v.version} failed integrity check (hashMatches=${hashMatches}, signatureValid=${signatureValid}).`, ip: req.ip
    });
  }

  res.json({
    version: v.version,
    status: verified ? 'VERIFIED' : 'INTEGRITY COMPROMISED',
    verified, hashMatches, signatureValid,
    storedHash: v.hash, recomputedHash: currentHash
  });
});

router.get('/:id/versions/:version/download', (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc || doc.deleted) return res.status(404).json({ error: 'Document not found.' });
  const kase = cases.findById(doc.caseId);

  if (!canAccessCase(req.user, kase)) {
    auditLogs.add({ user: req.user.username, action: 'ACCESS_DENIED', documentId: doc.id, caseId: doc.caseId, details: 'Attempted download.', ip: req.ip });
    return res.status(403).json({ error: 'You do not have access to this document.' });
  }

  const v = versions.find(doc.id, Number(req.params.version));
  if (!v) return res.status(404).json({ error: 'Version not found.' });

  const filePath = path.join(UPLOAD_ROOT, doc.id, v.stored_name);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'Stored file is missing from disk.' });

  const buffer = fs.readFileSync(filePath);
  const currentHash = hashBuffer(buffer);
  const integrityOk = currentHash === v.hash && verifySignature(v.hash, v.signature);

  auditLogs.add({
    user: req.user.username, action: 'DOCUMENT_DOWNLOADED', documentId: doc.id, caseId: doc.caseId,
    details: `Version ${v.version}, integrityOk=${integrityOk}`, ip: req.ip
  });

  res.setHeader('X-Integrity-Verified', String(integrityOk));
  res.setHeader('Content-Disposition', `attachment; filename="${v.original_name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(buffer);
});

// --- Tamper demonstration -------------------------------------------------
// Purely illustrative: NEVER touches the real stored evidence file. Makes a
// throwaway copy in a separate "demo" folder, mutates that copy, and shows
// the resulting hash mismatch -- to demonstrate the integrity mechanism
// live without putting any real evidence at risk.
router.post('/:id/versions/:version/tamper-demo', (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc || doc.deleted) return res.status(404).json({ error: 'Document not found.' });
  const kase = cases.findById(doc.caseId);
  if (!canAccessCase(req.user, kase)) return res.status(403).json({ error: 'Access denied.' });

  const v = versions.find(doc.id, Number(req.params.version));
  if (!v) return res.status(404).json({ error: 'Version not found.' });

  const originalPath = path.join(UPLOAD_ROOT, doc.id, v.stored_name);
  if (!fs.existsSync(originalPath)) return res.status(410).json({ error: 'Stored file is missing from disk.' });

  // 1. Preserve original -- read-only, never modified.
  const originalBuffer = fs.readFileSync(originalPath);
  const originalHash = hashBuffer(originalBuffer);

  // 2. Create a demo copy in a separate folder.
  const demoDir = path.join(UPLOAD_ROOT, doc.id, 'demo');
  fs.mkdirSync(demoDir, { recursive: true });
  const demoPath = path.join(demoDir, `tamper-demo__${v.stored_name}`);
  fs.writeFileSync(demoPath, originalBuffer);

  // 3. Modify the demo copy only.
  const tamperedBuffer = Buffer.concat([originalBuffer, Buffer.from('\n[DEMO TAMPER MARKER]')]);
  fs.writeFileSync(demoPath, tamperedBuffer);

  // 4. Generate a new hash for the tampered copy.
  const tamperedHash = hashBuffer(tamperedBuffer);

  // 5. Show the mismatch.
  const match = originalHash === tamperedHash;

  auditLogs.add({
    user: req.user.username, action: 'DEMO_TAMPER_TEST', documentId: doc.id, caseId: doc.caseId,
    details: `Ran tamper demonstration on version ${v.version}. Original file untouched.`, ip: req.ip
  });

  res.json({
    message: 'Demo copy created and altered. The original stored file was never touched.',
    originalHash,
    tamperedHash,
    match,
    status: match ? 'VERIFIED' : 'INTEGRITY COMPROMISED'
  });
});

router.get('/:id/audit', (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  const kase = cases.findById(doc.caseId);
  if (!canAccessCase(req.user, kase)) return res.status(403).json({ error: 'Access denied.' });

  res.json({ logs: auditLogs.forDocument(doc.id) });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const doc = documents.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  documents.softDelete(doc.id);
  auditLogs.add({ user: req.user.username, action: 'DOCUMENT_ARCHIVED', documentId: doc.id, caseId: doc.caseId, ip: req.ip });
  res.json({ message: 'Document archived (soft-deleted). Files and audit history are retained.' });
});

module.exports = router;
