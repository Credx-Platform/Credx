'use strict';
/**
 * routes/myfreescorenow.js — MyFreeScoreNow (MFSN) integration endpoints.
 *
 * Per-client credentials live on users.mfsn_*. Sync pulls the latest credit
 * report from MFSN and writes scores + findings into user_analysis.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../db/database');
const mfsn = require('../lib/mfsnClient');
const { requireAuth } = require('./auth');

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Server-wide fallback token (e.g. an org-level MAPIK key). When set, it can be
// used to verify a memberId before a per-client credential is stored.
const ORG_FALLBACK_TOKEN = process.env.MFSN_ORG_API_TOKEN || '';

function publicStatus(creds) {
  return {
    connected: Boolean(creds && creds.apiToken),
    memberId: creds?.memberId || null,
    connectedAt: creds?.connectedAt || null,
    lastSyncedAt: creds?.lastSyncedAt || null,
  };
}

// ── POST /api/myfreescorenow/connect ──────────────────────────────────────────
// Body: { userId, mfsnMemberId, mfsnApiToken }
router.post('/connect',
  requireAuth, requireAdmin,
  body('userId').trim().notEmpty().withMessage('userId required'),
  body('mfsnMemberId').trim().notEmpty().withMessage('mfsnMemberId required'),
  body('mfsnApiToken').trim().notEmpty().withMessage('mfsnApiToken required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { userId, mfsnMemberId, mfsnApiToken } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Optional verification: if MFSN_VERIFY_ON_CONNECT=1, hit the MFSN verify
    // endpoint with the supplied creds before persisting. Defaults to off so
    // we can connect even if the verify path isn't exposed.
    if (process.env.MFSN_VERIFY_ON_CONNECT === '1') {
      try {
        await mfsn.verifyMember(mfsnMemberId, mfsnApiToken);
      } catch (err) {
        return res.status(err.status === 401 ? 401 : 502).json({
          error: 'Could not verify MyFreeScoreNow credentials',
          details: err.message,
        });
      }
    }

    const connectedAt = db.setMfsnCredentials(userId, mfsnMemberId, mfsnApiToken);
    res.json({ success: true, connectedAt });
  }
);

// ── GET /api/myfreescorenow/status/:userId ────────────────────────────────────
router.get('/status/:userId', requireAuth, requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const creds = db.getMfsnCredentials(req.params.userId);
  res.json(publicStatus(creds));
});

// ── DELETE /api/myfreescorenow/disconnect/:userId ─────────────────────────────
router.delete('/disconnect/:userId', requireAuth, requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.clearMfsnCredentials(req.params.userId);
  res.json({ success: true });
});

// ── POST /api/myfreescorenow/sync/:userId ─────────────────────────────────────
// Pulls scores + tradelines from MFSN and merges them into user_analysis.
router.post('/sync/:userId', requireAuth, requireAdmin, async (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const creds = db.getMfsnCredentials(req.params.userId);
  if (!creds || !creds.apiToken || !creds.memberId) {
    return res.status(400).json({
      error: 'MyFreeScoreNow not connected for this client. Connect credentials first.',
    });
  }

  // Pull scores and tradelines in parallel. If your MFSN account exposes a
  // single combined "report" endpoint instead, swap to mfsn.getReport().
  let scoresRaw, tradelinesRaw;
  try {
    [scoresRaw, tradelinesRaw] = await Promise.all([
      mfsn.getScores(creds.memberId, creds.apiToken),
      mfsn.getTradelines(creds.memberId, creds.apiToken),
    ]);
  } catch (err) {
    console.error('[mfsn] sync error:', err);
    return res.status(err.status === 401 ? 401 : 502).json({
      error: 'MyFreeScoreNow sync failed',
      details: err.message,
      mfsnStatus: err.status || null,
    });
  }

  const scores = mfsn.normalizeScores(scoresRaw);
  const tradelines = mfsn.normalizeTradelines(tradelinesRaw);
  const findings = mfsn.buildFindings(tradelines);

  // Merge into existing analysis without clobbering admin-entered fields.
  const existing = db.getAnalysis(user.id);
  const mergedAnalysis = {
    ...(existing?.analysis || {}),
    scores,
    findings,
    tradelines,
    source: 'myfreescorenow',
    syncedAt: new Date().toISOString(),
  };

  db.saveAnalysis({
    id: uuidv4(),
    user_id: user.id,
    analysis: mergedAnalysis,
    dispute_strategy: existing?.dispute_strategy || null,
    workflow: existing?.workflow || null,
  });

  db.markMfsnSynced(user.id);

  res.json({
    success: true,
    syncedAt: new Date().toISOString(),
    scores,
    findingsCount: findings.length,
    tradelinesCount: tradelines.length,
  });
});

// ── POST /api/myfreescorenow/verify ───────────────────────────────────────────
// Quick connectivity probe. Body: { mfsnMemberId, mfsnApiToken? }
// If apiToken omitted, uses ORG_FALLBACK_TOKEN (when configured).
router.post('/verify', requireAuth, requireAdmin, async (req, res) => {
  const memberId = String(req.body?.mfsnMemberId || '').trim();
  const token = String(req.body?.mfsnApiToken || ORG_FALLBACK_TOKEN || '').trim();
  if (!memberId) return res.status(400).json({ error: 'mfsnMemberId required' });
  if (!token) return res.status(400).json({ error: 'mfsnApiToken required (or set MFSN_ORG_API_TOKEN)' });

  try {
    const data = await mfsn.verifyMember(memberId, token);
    res.json({ ok: true, member: data });
  } catch (err) {
    res.status(err.status === 401 ? 401 : 502).json({
      ok: false,
      error: err.message,
      mfsnStatus: err.status || null,
    });
  }
});

module.exports = router;
