require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const caseRoutes = require('./routes/cases');
const documentRoutes = require('./routes/documents');
const auditRoutes = require('./routes/audit');
const { getOrCreateKeys } = require('./utils/security');

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Render/Railway/Heroku-style platforms sit behind a reverse proxy that
// terminates TLS. Trusting the proxy lets req.secure and req.ip reflect
// the real client connection instead of the internal proxy hop.
app.set('trust proxy', 1);

app.use(helmet({
  // Relaxed CSP so the plain HTML/CSS/JS frontend and Google Fonts still work.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:']
    }
  }
}));

// Force HTTPS in production: if the request arrived over plain HTTP
// (as reported by the trusted proxy), redirect to the HTTPS version.
if (IS_PROD) {
  app.use((req, res, next) => {
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/audit', auditRoutes);

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ensure the organizational signing key pair exists on boot.
getOrCreateKeys();

app.listen(PORT, () => {
  console.log(`Secure DMS running on port ${PORT} (${IS_PROD ? 'production' : 'development'} mode)`);
});
