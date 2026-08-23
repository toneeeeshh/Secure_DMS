const express = require('express');
const { auditLogs } = require('../utils/repo');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, requireRole('admin'), (req, res) => {
  const { user, action, from, to } = req.query;
  res.json({ logs: auditLogs.search({ user, action, from, to }) });
});

// Recomputes the entire hash chain from the genesis entry and confirms
// nothing has been altered, reordered, or deleted.
router.get('/verify-chain', verifyToken, requireRole('admin'), (req, res) => {
  res.json(auditLogs.verifyChain());
});

// Minimum viable "security alerts" feed: unauthorized access attempts and
// detected tampering, most recent first.
router.get('/alerts', verifyToken, requireRole('admin'), (req, res) => {
  const alerts = auditLogs.alerts().map(l => ({
    ...l,
    message: l.action === 'ACCESS_DENIED'
      ? 'Unauthorized access attempt detected.'
      : 'Document integrity compromised.'
  }));
  res.json({ alerts });
});

module.exports = router;
