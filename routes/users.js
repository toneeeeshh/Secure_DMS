const express = require('express');
const bcrypt = require('bcryptjs');
const { users, auditLogs } = require('../utils/repo');
const { verifyToken, requireRole } = require('../middleware/auth');
const { ROLES, ROLE_LABELS } = require('../utils/roles');

const router = express.Router();

router.use(verifyToken, requireRole('admin'));

router.get('/', (req, res) => {
  res.json({ users: users.all(), roles: ROLES, labels: ROLE_LABELS });
});

router.post('/', (req, res) => {
  const { username, password, name, role } = req.body;

  if (!username || !password || password.length < 8 || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Valid username, password (8+ chars), and role are required.' });
  }
  if (users.findByUsername(username)) {
    return res.status(409).json({ error: 'That username already exists.' });
  }

  users.create({
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    name: name || username,
    createdAt: new Date().toISOString()
  });
  auditLogs.add({ user: req.user.username, action: 'CREATE_USER', details: `Created user ${username} (${role}).`, ip: req.ip });
  res.json({ message: 'User created.', user: { username, role, name: name || username } });
});

router.patch('/:username/active', (req, res) => {
  const user = users.findByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const active = !!req.body.active;
  users.setActive(user.username, active);
  auditLogs.add({
    user: req.user.username,
    action: 'PERMISSION_CHANGED',
    details: `${active ? 'Activated' : 'Deactivated'} user ${user.username}.`,
    ip: req.ip
  });
  res.json({ message: `User ${active ? 'activated' : 'deactivated'}.` });
});

router.patch('/:username/role', (req, res) => {
  const user = users.findByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Invalid role.' });

  const oldRole = user.role;
  users.setRole(user.username, req.body.role);
  auditLogs.add({
    user: req.user.username,
    action: 'PERMISSION_CHANGED',
    details: `Changed ${user.username}'s role from ${oldRole} to ${req.body.role}.`,
    ip: req.ip
  });
  res.json({ message: 'Role updated.' });
});

module.exports = router;
