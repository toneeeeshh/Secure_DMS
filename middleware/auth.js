const jwt = require('jsonwebtoken');

const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD && !process.env.JWT_SECRET) {
  console.error(
    'FATAL: JWT_SECRET environment variable is not set. ' +
    'Refusing to start in production without a real secret. ' +
    'Set JWT_SECRET to a long random string (see .env.example).'
  );
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-before-real-deployment';

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { username, role, name }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole, JWT_SECRET };
