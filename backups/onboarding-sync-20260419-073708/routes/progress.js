'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const db               = require('../db/database');
const mailer           = require('../email/mailer');
const creditAnalysis   = require('../analysis/creditReportAnalysis');
const { requireAuth }  = require('./auth');

// ── POST /api/progress/docs — record a document upload ───────────────────────
// When the uploaded document is identified as a credit report:
//   1. Seeds the standard analysis template + full workflow for this client
//   2. Fires an advisor alert email so the team knows to start reviewing
router.post('/docs', requireAuth, async (req, res) => {
  try {
    const { name, fileName, size, contentType, type } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Document name is required' });
    }

    const doc = db.createDocument({
      id:           uuidv4(),
      user_id:      req.userId,
      name,
      file_name:    fileName || name,
      size:         size     || 0,
      content_type: contentType || null,
      doc_type:     type || 'other',
    });

    // Detect credit report uploads by doc_type or name keywords
    const isCreditReport =
      (type || '').toLowerCase() === 'credit_report' ||
      (name || '').toLowerCase().includes('credit') ||
      (name || '').toLowerCase().includes('report');

    let analysisResult = null;

    if (isCreditReport) {
      // Get the client's name for the analysis record
      const user       = db.getUserById(req.userId);
      const clientName = user
        ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
        : 'Client';

      // Seed analysis + workflow — idempotent, safe to call on every upload
      analysisResult = creditAnalysis.runForUser(req.userId, clientName, db);

      // Notify advisor that a report is ready for review — fire-and-forget
      mailer.sendReportUploadAlert({
        clientName,
        clientEmail: user?.email || '',
        userId:      req.userId,
        docName:     fileName || name,
        lead_id:     null,  // no lead_id at portal stage; logged without lead reference
      }).catch(err => console.error('[progress] report upload alert failed:', err.message));
    }

    res.status(201).json({
      doc_id:       doc.id,
      doc_type:     doc.doc_type,
      credit_report: isCreditReport,
      analysis:     analysisResult,
    });
  } catch (err) {
    console.error('[progress] docs error:', err);
    res.status(500).json({ error: 'Could not save document' });
  }
});

// ── GET /api/progress/docs — list documents for authenticated user ─────────────
router.get('/docs', requireAuth, (req, res) => {
  const docs = db.getDocumentsByUser(req.userId);
  res.json({ docs });
});

// ── GET /api/progress/workflow — get current workflow stage for user ───────────
router.get('/workflow', requireAuth, (req, res) => {
  const cached = db.getAnalysis(req.userId);
  if (!cached) {
    return res.json({
      stage:  null,
      stages: creditAnalysis.WORKFLOW_STAGES,
      status: 'no_report_uploaded',
    });
  }
  res.json({
    stage:           cached.workflow?.stage    || null,
    stages:          creditAnalysis.WORKFLOW_STAGES,
    analysis_status: cached.analysis?.status  || null,
    strategy:        cached.dispute_strategy  || null,
    startedAt:       cached.workflow?.startedAt || null,
  });
});

module.exports = router;
