#!/usr/bin/env node
'use strict';
/**
 * seed-galloway.js
 *
 * Seeds the Sharon Galloway reference case for a given portal user.
 * Usage: node seed-galloway.js <userId> [userId2 ...]
 *
 * The Sharon Galloway case includes:
 *   - Full credit analysis (scores, findings, profile issues)
 *   - Standard dispute strategy (4 phases, FCRA/FDCPA/CROA laws)
 *   - Round-1 workflow stage
 *   - 6 pre-drafted disputes with generated letters for all 3 bureaus
 *
 * Run from the onboarding directory:
 *   node scripts/seed-galloway.js <userId>
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Load environment and database (resolve from this script's location)
const ONBOARDING_DIR = path.resolve(__dirname, '..', 'onboarding');
require('dotenv').config({ path: path.join(ONBOARDING_DIR, '.env') });
const db = require(path.join(ONBOARDING_DIR, 'db', 'database'));
const { STANDARD_DISPUTE_STRATEGY, WORKFLOW_STAGES } = require(path.join(ONBOARDING_DIR, 'analysis', 'creditReportAnalysis'));

// ── Bureau addresses for dispute letters ──────────────────────────────────────
const BUREAU_ADDRESSES = {
  equifax:    'Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374-0256',
  experian:   'Experian\nP.O. Box 4500\nAllen, TX 75013',
  transunion: 'TransUnion LLC Consumer Dispute Center\nP.O. Box 2000\nChester, PA 19016',
};

// ── Sharon Galloway preset disputes ───────────────────────────────────────────
const PRESET_DISPUTES = [
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
];

// ── Letter generator ──────────────────────────────────────────────────────────
function buildDisputeLetter({ clientName, accountName, accountNumber, bureau, reason, request, notes, law }) {
  const bureauKey = (bureau || '').toLowerCase().replace(/[\s-]/g, '');
  const address   = BUREAU_ADDRESSES[bureauKey] || bureau;
  const today     = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const lawCite   = Array.isArray(law) && law.length ? `\nApplicable law: ${law.join(', ')}` : '';

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

// ── Main seeder ────────────────────────────────────────────────────────────────
function seedGalloway(userId) {
  const user = db.getUserById(userId);
  if (!user) {
    console.error(`[seed-galloway] User not found: ${userId}`);
    return false;
  }

  const clientName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  console.log(`[seed-galloway] Seeding Sharon Galloway case for: ${clientName} (${userId})`);

  // 1. Clear existing disputes
  db.deleteDisputesByUser(userId);

  // 2. Build full analysis record
  const analysis = {
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
  };

  const workflow = {
    stage:  'round_one_disputes_ready',
    next:   ['mail_round_one_packets', 'wait_for_responses'],
    stages: WORKFLOW_STAGES,
  };

  // 3. Save analysis + strategy + workflow
  db.saveAnalysis({
    id:               uuidv4(),
    user_id:          userId,
    analysis,
    dispute_strategy: STANDARD_DISPUTE_STRATEGY,
    workflow,
  });
  console.log(`  ✓ Analysis saved (scores: 512/498/521)`);

  // 4. Create preset disputes with generated letters
  for (const d of PRESET_DISPUTES) {
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

    db.createDispute({
      id:               uuidv4(),
      user_id:          userId,
      account_name:     d.accountName,
      account_number:   d.accountNumber || null,
      bureau:           d.bureau,
      reason:           d.reason,
      request:          d.request,
      notes:            d.notes  || null,
      priority:         d.priority,
      generated_letter: letter,
    });
  }
  console.log(`  ✓ ${PRESET_DISPUTES.length} disputes created`);

  // 5. Verify
  const result = db.getAnalysis(userId);
  const disputes = db.getDisputesByUser(userId);
  console.log(`  ✓ Verified — analysis scores: ${JSON.stringify(result.analysis.scores)}, disputes: ${disputes.length}`);

  return true;
}

// ── CLI entry point ────────────────────────────────────────────────────────────
const userIds = process.argv.slice(2);

if (userIds.length === 0) {
  console.error('Usage: node seed-galloway.js <userId> [userId2 ...]');
  console.error('       node seed-galloway.js --list    # show all client user IDs');
  process.exit(1);
}

if (userIds[0] === '--list') {
  const clients = db.getAllClientsWithStatus();
  console.log('Client IDs:');
  for (const c of clients) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
    console.log(`  ${c.id}  ${name}  (${c.email})`);
  }
  process.exit(0);
}

let success = 0;
for (const uid of userIds) {
  if (seedGalloway(uid)) success++;
}

console.log(`\nDone: ${success}/${userIds.length} users seeded.`);