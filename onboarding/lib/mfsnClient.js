'use strict';
/**
 * lib/mfsnClient.js — MyFreeScoreNow (MFSN) API client.
 *
 * MFSN's reseller/affiliate API contract is not fully documented publicly, so
 * paths and auth-header style are env-overridable. Adjust via env once final
 * docs are confirmed:
 *   MFSN_BASE_URL          default: https://api.myfreescorenow.com
 *   MFSN_AUTH_SCHEME       'bearer' | 'apikey' | 'raw'   default: 'bearer'
 *   MFSN_AUTH_HEADER       header name for 'apikey'/'raw'   default: 'X-API-Key'
 *   MFSN_PATH_REPORT       template, {memberId} substituted   default: '/v1/members/{memberId}/report'
 *   MFSN_PATH_SCORES       default: '/v1/members/{memberId}/scores'
 *   MFSN_PATH_TRADELINES   default: '/v1/members/{memberId}/tradelines'
 *   MFSN_PATH_VERIFY       default: '/v1/members/{memberId}'
 *
 * UAT: set MFSN_BASE_URL=https://uat-api.myfreescorenow.com
 */

const BASE_URL      = (process.env.MFSN_BASE_URL || 'https://api.myfreescorenow.com').replace(/\/+$/, '');
const AUTH_SCHEME   = (process.env.MFSN_AUTH_SCHEME || 'bearer').toLowerCase();
const AUTH_HEADER   = process.env.MFSN_AUTH_HEADER || 'X-API-Key';
const PATH_REPORT   = process.env.MFSN_PATH_REPORT     || '/v1/members/{memberId}/report';
const PATH_SCORES   = process.env.MFSN_PATH_SCORES     || '/v1/members/{memberId}/scores';
const PATH_TRADES   = process.env.MFSN_PATH_TRADELINES || '/v1/members/{memberId}/tradelines';
const PATH_VERIFY   = process.env.MFSN_PATH_VERIFY     || '/v1/members/{memberId}';
const TIMEOUT_MS    = parseInt(process.env.MFSN_TIMEOUT_MS || '20000', 10);

function buildHeaders(apiToken) {
  const h = { 'Accept': 'application/json' };
  if (AUTH_SCHEME === 'bearer') {
    h.Authorization = `Bearer ${apiToken}`;
  } else if (AUTH_SCHEME === 'raw') {
    h[AUTH_HEADER] = apiToken;
  } else {
    h[AUTH_HEADER] = apiToken;
  }
  return h;
}

function fillPath(template, memberId) {
  return template.replace('{memberId}', encodeURIComponent(memberId || ''));
}

class MfsnError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'MfsnError';
    this.status = status || 0;
    this.body = body;
  }
}

async function mfsnFetch(path, apiToken) {
  if (!apiToken) throw new MfsnError('Missing MyFreeScoreNow API token', { status: 400 });
  const url = `${BASE_URL}${path}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: buildHeaders(apiToken), signal: ctl.signal });
  } catch (err) {
    clearTimeout(t);
    if (err.name === 'AbortError') throw new MfsnError(`MFSN request timed out after ${TIMEOUT_MS}ms`, { status: 504 });
    throw new MfsnError(`MFSN network error: ${err.message}`, { status: 0 });
  }
  clearTimeout(t);

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `MFSN ${res.status} on ${path}`;
    throw new MfsnError(msg, { status: res.status, body });
  }
  return body;
}

// ── Public API ───────────────────────────────────────────────────────────────

async function verifyMember(memberId, apiToken) {
  return mfsnFetch(fillPath(PATH_VERIFY, memberId), apiToken);
}

async function getScores(memberId, apiToken) {
  return mfsnFetch(fillPath(PATH_SCORES, memberId), apiToken);
}

async function getReport(memberId, apiToken) {
  return mfsnFetch(fillPath(PATH_REPORT, memberId), apiToken);
}

async function getTradelines(memberId, apiToken) {
  return mfsnFetch(fillPath(PATH_TRADES, memberId), apiToken);
}

// ── Normalization ────────────────────────────────────────────────────────────
// MFSN's exact response shape varies. These normalizers tolerate several common
// keys so we can ship without freezing on the response contract.

function pickScore(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}

function normalizeScores(raw) {
  if (!raw) return { equifax: null, experian: null, transunion: null, pulledAt: null };
  // Accept either flat shape or { scores: {...} } nesting.
  const s = raw.scores || raw.data?.scores || raw.data || raw;
  return {
    equifax:    pickScore(s, 'equifax', 'eq', 'EQ', 'equifax_score', 'equifaxScore'),
    experian:   pickScore(s, 'experian', 'ex', 'EX', 'experian_score', 'experianScore'),
    transunion: pickScore(s, 'transunion', 'tu', 'TU', 'transunion_score', 'transunionScore'),
    pulledAt:   raw.pulled_at || raw.pulledAt || raw.report_date || raw.reportDate || raw.as_of || null,
  };
}

function normalizeTradelines(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw
    : Array.isArray(raw.tradelines) ? raw.tradelines
    : Array.isArray(raw.data?.tradelines) ? raw.data.tradelines
    : Array.isArray(raw.data) ? raw.data
    : Array.isArray(raw.accounts) ? raw.accounts
    : [];

  return list.map((t) => ({
    creditor:      t.creditor || t.creditor_name || t.account_name || t.name || null,
    accountNumber: t.account_number || t.accountNumber || t.acct_number || null,
    accountType:   t.account_type || t.accountType || t.type || null,
    bureau:        t.bureau || t.source || null,
    balance:       num(t.balance),
    pastDue:       num(t.past_due ?? t.pastDue),
    creditLimit:   num(t.credit_limit ?? t.creditLimit),
    status:        t.status || t.account_status || null,
    paymentStatus: t.payment_status || t.paymentStatus || null,
    isDerogatory:  Boolean(t.is_derogatory ?? t.isDerogatory ?? isDerogStatus(t.status || t.account_status || t.payment_status)),
    isCollection:  Boolean(t.is_collection ?? /collection/i.test(String(t.account_type || t.type || ''))),
    dateOpened:    t.date_opened || t.dateOpened || null,
    dateReported:  t.date_reported || t.dateReported || null,
    raw:           t,
  }));
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isDerogStatus(s) {
  return /charge[ -]?off|charged[ -]?off|collection|late|delinquent|derogatory|past[ -]?due|repossess|foreclos/i.test(String(s || ''));
}

/**
 * Build the analysis.findings array CredX expects from a tradeline list.
 * Each finding represents a dispute opportunity surfaced from the bureau report.
 */
function buildFindings(tradelines) {
  return tradelines
    .filter((t) => t.isDerogatory || t.isCollection || (t.pastDue && t.pastDue > 0))
    .map((t) => ({
      type:        t.isCollection ? 'collection' : (t.isDerogatory ? 'derogatory' : 'past_due'),
      creditor:    t.creditor,
      account:     t.accountNumber,
      bureau:      t.bureau,
      balance:     t.balance,
      pastDue:     t.pastDue,
      status:      t.status || t.paymentStatus,
      severity:    t.isCollection ? 'high' : (t.isDerogatory ? 'medium' : 'low'),
      source:      'myfreescorenow',
    }));
}

module.exports = {
  MfsnError,
  verifyMember,
  getScores,
  getReport,
  getTradelines,
  normalizeScores,
  normalizeTradelines,
  buildFindings,
  // exported for tests / debugging
  _config: { BASE_URL, AUTH_SCHEME, AUTH_HEADER, PATH_REPORT, PATH_SCORES, PATH_TRADES, PATH_VERIFY },
};
