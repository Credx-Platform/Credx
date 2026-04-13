'use strict';
require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');

const leadsRouter        = require('./routes/leads');
const contractsRouter    = require('./routes/contracts');
const applicationsRouter = require('./routes/applications');
const monitoringRouter   = require('./routes/monitoring');
const authRouter         = require('./routes/auth');
const disputesRouter     = require('./routes/disputes');
const progressRouter     = require('./routes/progress');
const adminRouter        = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & parsing middleware ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com'],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
    },
  },
}));

app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/disputes',     disputesRouter);
app.use('/api/progress',     progressRouter);
app.use('/api/leads',        leadsRouter);
app.use('/api/contracts',    contractsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/monitoring',   monitoringRouter);
app.use('/api/admin',        adminRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Named HTML routes (before SPA fallback) ───────────────────────────────────
app.get('/portal',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));
app.get('/portal/activate', (req, res) => res.sendFile(path.join(__dirname, 'public', 'activate.html')));
app.get('/login',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── SPA fallback — serve index.html for any non-API route ────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[credx-onboarding] Server running on http://localhost:${PORT}`);
  console.log(`[credx-onboarding] Encryption at rest: ${require('./db/database').ENCRYPT_ENABLED ? 'ENABLED' : 'DISABLED (set ENCRYPTION_KEY)'}`);
});

module.exports = app;
