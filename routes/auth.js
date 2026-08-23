const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { users, auditLogs } = require('../utils/repo');
const { verifyToken, JWT_SECRET } = require('../middleware/auth');
const { ROLES, ROLE_LABELS } = require('../utils/roles');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

// One-time bootstrap: if the system has no users yet, allow creating the
// first admin account without authentication.
router.post('/bootstrap', loginLimiter, (req, res) => {
  if (users.count() > 0) {
    return res.status(403).json({ error: 'System already initialized. Ask an administrator for an account.' });
  }
  const { username, password, name } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and a password of at least 8 characters are required.' });
  }

  users.create({
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'admin',
    name: name || username,
    createdAt: new Date().toISOString()
  });
  auditLogs.add({ user: username, action: 'CREATE_USER', details: 'Bootstrap admin account created.' });

  res.json({ message: 'Admin account created. You can now log in.' });
});

router.get('/needs-bootstrap', (req, res) => {
  res.json({ needsBootstrap: users.count() === 0 });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const user = users.findByUsername(username);
  const ip = req.ip;

  if (!user || !user.active || !bcrypt.compareSync(password || '', user.password_hash)) {
    auditLogs.add({ user: username || 'unknown', action: 'LOGIN_FAILED', ip });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  auditLogs.add({ user: username, action: 'LOGIN', ip });
  res.json({ token, user: { username: user.username, role: user.role, name: user.name } });
});

// JWTs are stateless, so "logout" is mainly a client-side token discard --
// but we still record it, since LOGOUT is a required audit event.
router.post('/logout', verifyToken, (req, res) => {
  auditLogs.add({ user: req.user.username, action: 'LOGOUT', ip: req.ip });
  res.json({ message: 'Logged out.' });
});

router.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

router.get('/roles', (req, res) => res.json({ roles: ROLES, labels: ROLE_LABELS }));

module.exports = router;
