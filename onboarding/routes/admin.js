'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const router  = express.Router();

const db     = require('../db/database');
const mailer = require('../email/mailer');
const { requireAuth } = require('./auth');

const APP_URL = process.env.APP_URL || 'http://localhost:3001';

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  res.json(db.getAdminStats());
});

// ── GET /api/admin/clients ────────────────────────────────────────────────────
router.get('/clients', requireAuth, requireAdmin, (req, res) => {
  res.json({ clients: db.getAllClientsWithStatus() });
});

// ── GET /api/admin/clients/:userId ────────────────────────────────────────────
router.get('/clients/:userId', requireAuth, requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Client not found' });

  const lead        = db.getLeadByEmail(user.email);
  const application = lead ? db.getApplicationByLead(lead.id) : null;
  const disputes    = db.getDisputesByUser(user.id);
  const analysis    = db.getAnalysis(user.id);
  const documents   = db.getDocumentsByUser(user.id);

  const { password_hash, invite_token, ...safeUser } = user;

  res.json({
    user: safeUser,
    lead,
    application: application ? { ...application, ssn: '[PROTECTED]', dob: '[PROTECTED]' } : null,
    disputes,
    analysis,
    documents,
  });
});

// ── PUT /api/admin/clients/:userId/analysis ───────────────────────────────────
router.put('/clients/:userId/analysis', requireAuth, requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Client not found' });

  const existing = db.getAnalysis(user.id);
  const merged   = { ...(existing?.analysis || {}), ...req.body };

  db.saveAnalysis({
    id:               uuidv4(),
    user_id:          user.id,
    analysis:         merged,
    dispute_strategy: existing?.dispute_strategy || null,
    workflow:         existing?.workflow || null,
  });

  res.json({ success: true });
});

// ── PUT /api/admin/clients/:userId/workflow ───────────────────────────────────
router.put('/clients/:userId/workflow', requireAuth, requireAdmin, (req, res) => {
  const { stage } = req.body;
  if (!stage) return res.status(400).json({ error: 'stage required' });

  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Client not found' });

  const existing = db.getAnalysis(user.id);
  if (!existing) return res.status(404).json({ error: 'No analysis for this client yet' });

  const updatedWorkflow = { ...(existing.workflow || {}), stage };

  db.saveAnalysis({
    id:               uuidv4(),
    user_id:          user.id,
    analysis:         existing.analysis,
    dispute_strategy: existing.dispute_strategy,
    workflow:         updatedWorkflow,
  });

  res.json({ success: true, stage });
});

// ── POST /api/admin/clients/:userId/invite ────────────────────────────────────
router.post('/clients/:userId/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'Client not found' });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt   = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    db.setInviteToken(user.id, inviteToken, expiresAt);

    const inviteUrl = `${APP_URL}/portal/activate?token=${inviteToken}`;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

    await mailer.sendPortalInvite({ to: user.email, name, inviteUrl, lead_id: null });

    res.json({ success: true, inviteUrl });
  } catch (err) {
    console.error('[admin] invite error:', err);
    res.status(500).json({ error: 'Could not send invite' });
  }
});

// ── GET /api/admin/review-queue ───────────────────────────────────────────────
router.get('/review-queue', requireAuth, requireAdmin, (req, res) => {
  res.json({ queue: db.getReviewQueue() });
});

// ── POST /api/admin/seed — bootstrap first admin (secret-gated) ───────────────
router.post('/seed', async (req, res) => {
  try {
    const { email, password, secret } = req.body;
    const SEED_SECRET = process.env.ADMIN_SEED_SECRET;
    if (!SEED_SECRET || secret !== SEED_SECRET) {
      return res.status(403).json({ error: 'Invalid seed secret' });
    }

    let user = db.getUserByEmail(email);
    if (user) {
      db.setUserRole(user.id, 'admin');
      return res.json({ message: 'User promoted to admin', userId: user.id });
    }

    const password_hash = await bcrypt.hash(password, 12);
    user = db.createUser({ id: uuidv4(), email, password_hash, first_name: 'Admin', last_name: null, phone: null });
    db.setUserRole(user.id, 'admin');
    res.status(201).json({ message: 'Admin created', userId: user.id });
  } catch (err) {
    console.error('[admin] seed error:', err);
    res.status(500).json({ error: 'Could not create admin' });
  }
});

// ── DELETE /api/admin/clients/:userId/disputes — clear all disputes ───────────
router.delete('/clients/:userId/disputes', requireAuth, requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Client not found' });
  db.deleteDisputesByUser(user.id);
  res.json({ success: true });
});

module.exports = router;
