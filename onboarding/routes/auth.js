'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const router   = express.Router();

const db = require('../db/database');

const JWT_SECRET  = process.env.JWT_SECRET  || 'credx-dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';

function makeToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function safeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register',
  body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body('lastName').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body('phone').optional({ checkFalsy: true }).trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const { email, password, firstName, lastName, phone } = req.body;

      const existing = db.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const user = db.createUser({
        id: uuidv4(),
        email,
        password_hash,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
      });

      const token = makeToken(user);
      res.status(201).json({ token, user: safeUser(user) });
    } catch (err) {
      console.error('[auth] register error:', err);
      res.status(500).json({ error: 'Could not create account' });
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login',
  body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const { email, password } = req.body;

      const user = db.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = makeToken(user);
      res.json({ token, user: safeUser(user) });
    } catch (err) {
      console.error('[auth] login error:', err);
      res.status(500).json({ error: 'Could not sign in' });
    }
  }
);

// ── POST /api/auth/accept-invite — consume invite token, set password ─────────
router.post('/accept-invite',
  body('token').trim().notEmpty().withMessage('Invite token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const { token, password } = req.body;

      const user = db.getUserByInviteToken(token);
      if (!user) {
        return res.status(400).json({ error: 'This invite link is invalid or has expired. Please contact support.' });
      }

      const password_hash = await bcrypt.hash(password, 12);
      db.consumeInvite(user.id, password_hash);

      const freshUser = db.getUserById(user.id);
      const jwtToken  = makeToken(freshUser);

      res.json({ token: jwtToken, user: safeUser(freshUser) });
    } catch (err) {
      console.error('[auth] accept-invite error:', err);
      res.status(500).json({ error: 'Could not activate account' });
    }
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: safeUser(user) });
});

// ── Auth middleware (exported for other routes) ───────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    req.userRole  = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
