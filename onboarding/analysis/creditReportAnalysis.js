'use strict';
/**
 * analysis/creditReportAnalysis.js
 *
 * Permanent credit report analysis template and runner.
 *
 * Every time a client uploads a credit report, `runForUser()` is called.
 * It seeds a structured analysis shell + full workflow roadmap in the DB
 * so the advisor can open the client's portal, see all stages laid out,
 * and fill in the specific findings from the uploaded report.
 *
 * Structure mirrors the Sharon Galloway reference case — same phases,
 * same dispute strategy, same workflow stages — parameterized per client.
 *
 * Idempotent: safe to call multiple times; will not overwrite an existing
 * completed analysis, but WILL update an analysis still in pending_review.
 */

const { v4: uuidv4 } = require('uuid');

// ── Workflow stage definitions ─────────────────────────────────────────────────
// Every client follows this same roadmap. The advisor advances the stage
// as work is completed. Matches the Sharon Galloway reference workflow.
const WORKFLOW_STAGES = [
  { id: 'credit_report_received',    label: 'Credit Report Received',        description: 'Report uploaded. Awaiting advisor review.' },
  { id: 'advisor_review_pending',    label: 'Advisor Review In Progress',    description: 'Advisor is reviewing the report and identifying disputable items.' },
  { id: 'round_one_disputes_ready',  label: 'Round 1 Disputes Ready',        description: 'Dispute letters drafted and ready to mail.' },
  { id: 'mail_round_one_packets',    label: 'Round 1 Packets Mailed',        description: 'Letters sent to Equifax, Experian, and TransUnion.' },
  { id: 'wait_for_responses',        label: 'Waiting for Bureau Responses',  description: 'Bureaus have 30 days to respond under FCRA § 611.' },
  { id: 'round_two_follow_up',       label: 'Round 2 Follow-Up',            description: 'MOV requests or escalation letters prepared based on responses.' },
  { id: 'cfpb_escalation',           label: 'CFPB Escalation (if needed)',  description: 'CFPB complaint filed for non-compliant bureau responses.' },
  { id: 'goodwill_campaign',         label: 'Goodwill Campaign',            description: 'Creditor letters for late payment / negative mark removal.' },
  { id: 'completed',                 label: 'Case Completed',               description: 'All rounds complete. Final score review in progress.' },
];

// ── Standard dispute strategy phases ──────────────────────────────────────────
// Based on the Sharon Galloway reference case.
const STANDARD_DISPUTE_STRATEGY = {
  phases: [
    'Round 1 disputes — challenge unverifiable items at all 3 bureaus under FCRA § 611',
    'MOV requests — demand method of verification after any "verified" responses',
    'CFPB escalation — file complaint if bureaus fail Metro 2 compliance',
    'Goodwill campaign — creditor letters requesting removal of late payments / negative marks',
  ],
  laws: [
    'Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq.',
    'Fair Debt Collection Practices Act (FDCPA), 15 U.S.C. § 1692 et seq.',
    'Credit Repair Organizations Act (CROA), 15 U.S.C. § 1679 et seq.',
  ],
};

// ── Analysis shell builder ─────────────────────────────────────────────────────
// Creates the initial analysis structure for a new client.
// Scores, findings, and profileIssues are left null/empty for the advisor to fill.
function buildInitialAnalysis(clientName) {
  return {
    clientName,
    reportDate:    new Date().toISOString().split('T')[0],
    status:        'pending_review',  // advisor must complete this
    scores: {
      equifax:    null,  // advisor fills from uploaded report
      experian:   null,
      transunion: null,
    },
    summary: {
      utilization:     null,  // e.g. "87%"
      derogatoryCount: null,  // e.g. 7
    },
    findings:      [],  // advisor adds: account names, issues found
    profileIssues: [],  // advisor adds: address discrepancies, unauthorized inquiries, etc.
    strategy:      STANDARD_DISPUTE_STRATEGY.phases,
    laws:          STANDARD_DISPUTE_STRATEGY.laws,
    _template:     'standard-v1',
  };
}

// ── Workflow builder ───────────────────────────────────────────────────────────
function buildInitialWorkflow() {
  return {
    stage:   'credit_report_received',
    next:    ['advisor_review_pending'],
    stages:  WORKFLOW_STAGES,
    startedAt: new Date().toISOString(),
  };
}

// ── Main runner — called on every credit report upload ─────────────────────────
/**
 * Seeds analysis + workflow for a client.
 * @param {string} user_id  - Portal user ID
 * @param {string} clientName - Full name (for the analysis record)
 * @param {object} db       - The database module
 * @returns {{ seeded: boolean, status: string, analysis: object, workflow: object }}
 */
function runForUser(user_id, clientName, db) {
  const existing = db.getAnalysis(user_id);

  // Don't overwrite a completed analysis — only update if still pending review
  if (existing && existing.analysis && existing.analysis.status !== 'pending_review') {
    return {
      seeded:   false,
      status:   'already_complete',
      analysis: existing.analysis,
      workflow: existing.workflow,
    };
  }

  const analysis        = buildInitialAnalysis(clientName);
  const disputeStrategy = STANDARD_DISPUTE_STRATEGY;
  const workflow        = buildInitialWorkflow();

  db.saveAnalysis({
    id:               uuidv4(),
    user_id,
    analysis,
    dispute_strategy: disputeStrategy,
    workflow,
  });

  return {
    seeded:   true,
    status:   'pending_review',
    analysis,
    workflow,
  };
}

module.exports = {
  WORKFLOW_STAGES,
  STANDARD_DISPUTE_STRATEGY,
  buildInitialAnalysis,
  buildInitialWorkflow,
  runForUser,
};
