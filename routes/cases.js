const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { cases, documents, users, auditLogs } = require('../utils/repo');
const { verifyToken, requireRole } = require('../middleware/auth');
const { CAN_CREATE_CASE, canAccessCase, canManageCaseMembers } = require('../utils/roles');

const router = express.Router();
router.use(verifyToken);

function publicCase(kase) {
  return {
    id: kase.id,
    caseNumber: kase.caseNumber,
    title: kase.title,
    description: kase.description,
    createdBy: kase.createdBy,
    createdAt: kase.createdAt,
    members: kase.members,
    status: kase.status
  };
}

// Create a new case.
router.post('/', requireRole(...CAN_CREATE_CASE, 'admin'), (req, res) => {
  const { caseNumber, title, description } = req.body;
  if (!caseNumber || !title) {
    return res.status(400).json({ error: 'Case number and title are required.' });
  }

  const kase = {
    id: uuidv4(),
    caseNumber,
    title,
    description: description || '',
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    members: [],
    status: 'open'
  };
  cases.create(kase);

  auditLogs.add({
    user: req.user.username, action: 'CASE_CREATED', caseId: kase.id,
    details: `Created case "${title}" (${caseNumber}).`, ip: req.ip
  });

  res.json({ message: 'Case created.', case: publicCase(kase) });
});

// List cases visible to the requesting user, with basic search.
router.get('/', (req, res) => {
  const { q, caseNumber, title } = req.query;
  let list = cases.all().filter(c => canAccessCase(req.user, c));

  if (caseNumber) list = list.filter(c => c.caseNumber.toLowerCase().includes(caseNumber.toLowerCase()));
  if (title) list = list.filter(c => c.title.toLowerCase().includes(title.toLowerCase()));
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(c =>
      c.title.toLowerCase().includes(needle) ||
      c.caseNumber.toLowerCase().includes(needle) ||
      (c.description || '').toLowerCase().includes(needle)
    );
  }

  res.json({ cases: list.map(publicCase) });
});

// Open a case: details + its documents.
router.get('/:id', (req, res) => {
  const kase = cases.findById(req.params.id);
  if (!kase) return res.status(404).json({ error: 'Case not found.' });

  if (!canAccessCase(req.user, kase)) {
    auditLogs.add({ user: req.user.username, action: 'ACCESS_DENIED', caseId: kase.id, details: 'Attempted to open case.', ip: req.ip });
    return res.status(403).json({ error: 'You do not have access to this case.' });
  }

  auditLogs.add({ user: req.user.username, action: 'ACCESS_GRANTED', caseId: kase.id, details: 'Opened case.', ip: req.ip });

  const docs = documents.forCase(kase.id).map(d => ({
    id: d.id, documentCode: d.documentCode, title: d.title, type: d.type,
    currentVersion: d.currentVersion, uploadedBy: d.uploadedBy, createdAt: d.createdAt
  }));

  res.json({ case: publicCase(kase), documents: docs });
});

// Add an authorized member to a case.
router.post('/:id/members', (req, res) => {
  const kase = cases.findById(req.params.id);
  if (!kase) return res.status(404).json({ error: 'Case not found.' });

  if (!canManageCaseMembers(req.user, kase)) {
    auditLogs.add({ user: req.user.username, action: 'ACCESS_DENIED', caseId: kase.id, details: 'Attempted to add case member.', ip: req.ip });
    return res.status(403).json({ error: 'Only the case creator or an administrator can add members.' });
  }

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required.' });
  if (!users.findByUsername(username)) return res.status(404).json({ error: 'No such user exists.' });

  cases.addMember(kase.id, username);
  auditLogs.add({
    user: req.user.username, action: 'PERMISSION_CHANGED', caseId: kase.id,
    details: `Added ${username} to case ${kase.caseNumber}.`, ip: req.ip
  });

  res.json({ message: `${username} added to case.`, case: publicCase(cases.findById(kase.id)) });
});

// Remove a member from a case.
router.delete('/:id/members/:username', (req, res) => {
  const kase = cases.findById(req.params.id);
  if (!kase) return res.status(404).json({ error: 'Case not found.' });

  if (!canManageCaseMembers(req.user, kase)) {
    return res.status(403).json({ error: 'Only the case creator or an administrator can remove members.' });
  }

  cases.removeMember(kase.id, req.params.username);
  auditLogs.add({
    user: req.user.username, action: 'PERMISSION_CHANGED', caseId: kase.id,
    details: `Removed ${req.params.username} from case ${kase.caseNumber}.`, ip: req.ip
  });

  res.json({ message: 'Member removed.', case: publicCase(cases.findById(kase.id)) });
});

module.exports = router;
