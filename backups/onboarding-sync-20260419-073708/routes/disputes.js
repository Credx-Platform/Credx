'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const router  = express.Router();

const { STANDARD_DISPUTE_STRATEGY, WORKFLOW_STAGES } = require('../analysis/creditReportAnalysis');

const db = require('../db/database');
const { requireAuth } = require('./auth');

// ── GET /api/disputes — load workspace for authenticated user ─────────────────
router.get('/', requireAuth, (req, res) => {
  const disputes = db.getDisputesByUser(req.userId).map(row => ({
    id:              row.id,
    title:           row.account_name,
    accountNumber:   row.account_number,
    bureau:          row.bureau,
    reason:          row.reason,
    request:         row.request,
    notes:           row.notes,
    status:          row.status,
    priority:        row.priority,
    generatedLetter: row.generated_letter,
    createdAt:       row.created_at,
  }));

  const cached = db.getAnalysis(req.userId);

  res.json({
    disputes,
    analysis:        cached ? cached.analysis        : null,
    disputeStrategy: cached ? cached.dispute_strategy : null,
    workflow:        cached ? cached.workflow         : null,
  });
});

// ── POST /api/disputes — save a new dispute + generate draft letter ───────────
router.post('/',
  requireAuth,
  body('accountName').trim().notEmpty().withMessage('Account name is required'),
  body('bureau').trim().notEmpty().withMessage('Bureau is required'),
  body('reason').optional({ checkFalsy: true }).trim(),
  body('request').optional({ checkFalsy: true }).trim(),
  body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const { accountName, accountNumber, bureau, reason, request, notes } = req.body;

      const user = db.getUserById(req.userId);
      const clientName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email : 'Client';

      const letter = buildDisputeLetter({
        clientName,
        accountName,
        accountNumber,
        bureau,
        reason:  reason  || 'This account contains inaccurate information',
        request: request || 'Please investigate and correct or remove this item',
        notes,
      });

      const dispute = db.createDispute({
        id:               uuidv4(),
        user_id:          req.userId,
        account_name:     accountName,
        account_number:   accountNumber || null,
        bureau,
        reason:           reason  || null,
        request:          request || null,
        notes:            notes   || null,
        priority:         'medium',
        generated_letter: letter,
      });

      res.status(201).json({
        id:              dispute.id,
        title:           dispute.account_name,
        bureau:          dispute.bureau,
        status:          dispute.status,
        generatedLetter: dispute.generated_letter,
      });
    } catch (err) {
      console.error('[disputes] POST error:', err);
      res.status(500).json({ error: 'Could not save dispute' });
    }
  }
);

// ── POST /api/disputes/seed-case — load Sharon Galloway preset ────────────────
router.post('/seed-case', requireAuth, (req, res) => {
  try {
    const { presetId } = req.body || {};
    const preset = PRESETS[presetId];
    if (!preset) {
      return res.status(400).json({ error: `Unknown preset: ${presetId}` });
    }

    // Clear existing disputes for this user, then insert the preset
    db.deleteDisputesByUser(req.userId);

    const user = db.getUserById(req.userId);
    const clientName = user
      ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
      : 'Client';

    const inserted = preset.disputes.map(d => {
      const letter = buildDisputeLetter({
        clientName,
        accountName:   d.accountName,
        accountNumber: d.accountNumber,
        bureau:        d.bureau,
        reason:        d.reason,
        request:       d.request,
        notes:         d.notes,
        law:           d.law,
      });
      return db.createDispute({
        id:               uuidv4(),
        user_id:          req.userId,
        account_name:     d.accountName,
        account_number:   d.accountNumber || null,
        bureau:           d.bureau,
        reason:           d.reason || null,
        request:          d.request || null,
        notes:            d.notes  || null,
        priority:         d.priority || 'high',
        generated_letter: letter,
      });
    });

    // Save analysis snapshot
    db.saveAnalysis({
      id:               uuidv4(),
      user_id:          req.userId,
      analysis:         preset.analysis,
      dispute_strategy: preset.disputeStrategy,
      workflow:         preset.workflow,
    });

    res.json({
      analysis:        preset.analysis,
      disputeStrategy: preset.disputeStrategy,
      disputes: inserted.map(row => ({
        id:              row.id,
        title:           row.account_name,
        accountNumber:   row.account_number,
        bureau:          row.bureau,
        reason:          row.reason,
        status:          row.status,
        priority:        row.priority,
        generatedLetter: row.generated_letter,
      })),
    });
  } catch (err) {
    console.error('[disputes] seed-case error:', err);
    res.status(500).json({ error: 'Could not load preset' });
  }
});

module.exports = router;

// ── Letter generator ──────────────────────────────────────────────────────────
function buildDisputeLetter({ clientName, accountName, accountNumber, bureau, reason, request, notes, law }) {
  const bureauAddresses = {
    equifax:    'Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374-0256',
    experian:   'Experian\nP.O. Box 4500\nAllen, TX 75013',
    transunion: 'TransUnion LLC Consumer Dispute Center\nP.O. Box 2000\nChester, PA 19016',
  };
  const bureauKey = (bureau || '').toLowerCase().replace(/[\s-]/g, '');
  const address = bureauAddresses[bureauKey] || bureau;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const lawCite = Array.isArray(law) && law.length ? `\nApplicable law: ${law.join(', ')}` : '';

  return `${clientName}
[Your Address]
[City, State ZIP]
[Phone]
[Email]

${today}

${address}

Re: Dispute of Inaccurate Credit Information — ${accountName}${accountNumber ? ` (Account #${accountNumber})` : ''}

To Whom It May Concern:

I am writing pursuant to my rights under the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq., to dispute the following item appearing on my credit report:

  Account Name:   ${accountName}${accountNumber ? `\n  Account Number: ${accountNumber}` : ''}
  Bureau:         ${bureau}
  Dispute Reason: ${reason}${lawCite}

${request}

${notes ? `Additional information: ${notes}\n\n` : ''}Under FCRA Section 611, you are required to conduct a reasonable investigation into this dispute within 30 days of receipt. If you cannot verify the accuracy of this information, it must be promptly deleted or corrected.

Please send written confirmation of the results of your investigation to the address above.

Sincerely,

${clientName}

Enclosures:
  [ ] Copy of government-issued photo ID
  [ ] Copy of Social Security card or SSN verification
  [ ] Proof of current address (utility bill or bank statement)`;
}

// ── Sharon Galloway preset ────────────────────────────────────────────────────
const PRESETS = {
  galloway: {
    analysis: {
      clientName:  'Sharon Galloway',
      reportDate:  '2024-01-15',
      scores:      { equifax: 512, experian: 498, transunion: 521 },
      summary:     { utilization: '87%', derogatoryCount: 7 },
      findings: [
        'Midland Funding LLC — $4,200 collection (unverified)',
        'Capital One — 90-day late payment (2021)',
        'Portfolio Recovery — $1,800 duplicate collection entry',
        'Experian personal info discrepancy — 2 old addresses',
        'Inquiry cluster — 6 hard inquiries in 60 days',
        'Student loan — incorrect balance reported',
      ],
      profileIssues: [
        'Remove old address variants from all 3 bureaus',
        'Dispute unauthorized inquiries from auto dealers',
      ],
      strategy:  STANDARD_DISPUTE_STRATEGY.phases,
      laws:      STANDARD_DISPUTE_STRATEGY.laws,
      _template: 'standard-v1',
    },
    disputeStrategy: STANDARD_DISPUTE_STRATEGY,
    workflow: {
      stage:  'round_one_disputes_ready',
      next:   ['mail_round_one_packets', 'wait_for_responses'],
      stages: WORKFLOW_STAGES,
    },
    disputes: [
      {
        accountName:   'Midland Funding LLC',
        accountNumber: '****4821',
        bureau:        'Equifax',
        reason:        'This collection account is unverifiable. I do not recognize this debt and request full verification.',
        request:       'Please investigate and remove this unverified collection account. If you cannot provide verification, it must be deleted.',
        priority:      'high',
        law:           ['FCRA § 611', 'FDCPA § 809(b)'],
      },
      {
        accountName:   'Midland Funding LLC',
        accountNumber: '****4821',
        bureau:        'TransUnion',
        reason:        'This collection account is unverifiable. I do not recognize this debt.',
        request:       'Please investigate and remove this unverified collection account.',
        priority:      'high',
        law:           ['FCRA § 611', 'FDCPA § 809(b)'],
      },
      {
        accountName:   'Portfolio Recovery Associates',
        accountNumber: '****9034',
        bureau:        'Experian',
        reason:        'This appears to be a duplicate collection entry for the same debt. Reporting the same debt twice is a FCRA violation.',
        request:       'Please remove this duplicate entry. The same account is reported under a different entry, constituting duplicate reporting.',
        priority:      'high',
        law:           ['FCRA § 611', 'FCRA § 623'],
      },
      {
        accountName:   'Capital One',
        accountNumber: '****1177',
        bureau:        'Equifax',
        reason:        'The 90-day late payment reported for March 2021 is inaccurate. I was enrolled in a hardship program at the time.',
        request:       'Please investigate and correct or remove the inaccurate late payment notation.',
        priority:      'medium',
        law:           ['FCRA § 611'],
      },
      {
        accountName:   'Unauthorized Auto Dealer Inquiry',
        accountNumber: null,
        bureau:        'Experian',
        reason:        'I did not authorize this hard inquiry. I have no record of applying for credit with this dealer.',
        request:       'Please remove this unauthorized hard inquiry immediately.',
        priority:      'medium',
        law:           ['FCRA § 604'],
      },
      {
        accountName:   'Student Loan Servicer',
        accountNumber: '****7755',
        bureau:        'TransUnion',
        reason:        'The balance reported ($18,450) does not match my loan servicer records ($16,200). The balance is overstated.',
        request:       'Please investigate and correct the balance to reflect the accurate outstanding amount.',
        priority:      'medium',
        law:           ['FCRA § 611', 'FCRA § 623(a)(2)'],
      },
    ],
  },
};
