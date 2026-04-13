'use strict';
/**
 * db/database.js — SQLite persistence layer for CredX onboarding.
 *
 * All tables are designed for easy migration to Postgres later:
 *   - UUIDs as primary keys
 *   - ISO timestamps (stored as TEXT)
 *   - Sensitive fields (ssn, dob, monitoring_password) stored AES-256-GCM encrypted.
 *
 * TO ENCRYPT AT REST (production): set ENCRYPTION_KEY in .env (32-byte hex string).
 * Fields flagged SENSITIVE are encrypted before write and decrypted on read.
 */

const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/credx.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Encryption helpers ────────────────────────────────────────────────────────
const ENC_KEY_HEX = process.env.ENCRYPTION_KEY || '';
const ENCRYPT_ENABLED = ENC_KEY_HEX.length === 64; // 32 bytes hex = 64 chars

function encrypt(plaintext) {
  if (!ENCRYPT_ENABLED || !plaintext) return plaintext;
  const key = Buffer.from(ENC_KEY_HEX, 'hex');
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(stored) {
  if (!ENCRYPT_ENABLED || !stored || !String(stored).startsWith('enc:')) return stored;
  const parts = String(stored).split(':');
  if (parts.length !== 4) return stored;
  const [, ivHex, tagHex, encHex] = parts;
  const key = Buffer.from(ENC_KEY_HEX, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
}

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id            TEXT PRIMARY KEY,
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT,
    ip_address    TEXT,
    user_agent    TEXT,
    status        TEXT DEFAULT 'new',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contracts (
    id              TEXT PRIMARY KEY,
    lead_id         TEXT NOT NULL REFERENCES leads(id),
    signed_name     TEXT NOT NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    signed_at       TEXT NOT NULL,
    email_sent      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applications (
    id              TEXT PRIMARY KEY,
    lead_id         TEXT NOT NULL REFERENCES leads(id),
    full_name       TEXT,
    email           TEXT,
    phone           TEXT,
    address_line1   TEXT,
    address_line2   TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    dob             TEXT,    -- SENSITIVE: encrypted at rest
    ssn             TEXT,    -- SENSITIVE: encrypted at rest
    submitted_at    TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monitoring_submissions (
    id                TEXT PRIMARY KEY,
    lead_id           TEXT NOT NULL REFERENCES leads(id),
    provider          TEXT NOT NULL,
    username          TEXT,          -- SENSITIVE: encrypted at rest
    mon_password      TEXT,          -- SENSITIVE: encrypted at rest
    security_notes    TEXT,
    submitted_at      TEXT NOT NULL,
    created_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_events (
    id          TEXT PRIMARY KEY,
    lead_id     TEXT REFERENCES leads(id),
    event_type  TEXT NOT NULL,
    recipient   TEXT NOT NULL,
    status      TEXT DEFAULT 'queued',
    error       TEXT,
    sent_at     TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_queue (
    id              TEXT PRIMARY KEY,
    lead_id         TEXT NOT NULL REFERENCES leads(id),
    status          TEXT DEFAULT 'awaiting_analysis',
    assigned_to     TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    first_name      TEXT,
    last_name       TEXT,
    phone           TEXT,
    role            TEXT DEFAULT 'client',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS disputes (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    account_name    TEXT NOT NULL,
    account_number  TEXT,
    bureau          TEXT NOT NULL,
    reason          TEXT,
    request         TEXT,
    notes           TEXT,
    status          TEXT DEFAULT 'drafted',
    priority        TEXT DEFAULT 'medium',
    generated_letter TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_documents (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    file_name       TEXT,
    size            INTEGER,
    content_type    TEXT,
    doc_type        TEXT DEFAULT 'other',
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_analysis (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) UNIQUE,
    analysis        TEXT,
    dispute_strategy TEXT,
    workflow        TEXT,
    updated_at      TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT NOT NULL REFERENCES users(id),
    stripe_customer_id       TEXT,
    stripe_subscription_id   TEXT,
    stripe_session_id        TEXT,
    status                   TEXT DEFAULT 'none',
    plan                     TEXT,
    amount_cents             INTEGER,
    current_period_end       TEXT,
    cancel_at_period_end     INTEGER DEFAULT 0,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL
  );
`);

// ── Migration: invite columns on users (safe re-run) ─────────────────────────
const _existingUserCols = db.pragma('table_info(users)').map(c => c.name);
if (!_existingUserCols.includes('invite_token')) {
  db.exec(`ALTER TABLE users ADD COLUMN invite_token TEXT`);
  db.exec(`ALTER TABLE users ADD COLUMN invite_expires TEXT`);
  db.exec(`ALTER TABLE users ADD COLUMN invite_used INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 1`);
}

const now = () => new Date().toISOString();

// ── Leads ─────────────────────────────────────────────────────────────────────
const insertLead = db.prepare(`
  INSERT INTO leads (id, full_name, email, phone, ip_address, user_agent, status, created_at, updated_at)
  VALUES (@id, @full_name, @email, @phone, @ip_address, @user_agent, 'new', @ts, @ts)
`);

const _getLead        = db.prepare(`SELECT * FROM leads WHERE id = ?`);
const _getLeadByEmail = db.prepare(`SELECT * FROM leads WHERE email = ? ORDER BY created_at DESC LIMIT 1`);
const updateLeadStatus = db.prepare(`UPDATE leads SET status = ?, updated_at = ? WHERE id = ?`);

function getLead(id)        { return _getLead.get(id); }
function getLeadByEmail(em) { return _getLeadByEmail.get(em); }

function createLead({ id, full_name, email, phone, ip_address, user_agent }) {
  const ts = now();
  insertLead.run({ id, full_name, email, phone: phone || null, ip_address: ip_address || null, user_agent: user_agent || null, ts });
  return getLead(id);
}

// ── Contracts ─────────────────────────────────────────────────────────────────
const insertContract = db.prepare(`
  INSERT INTO contracts (id, lead_id, signed_name, ip_address, user_agent, signed_at, created_at)
  VALUES (@id, @lead_id, @signed_name, @ip_address, @user_agent, @signed_at, @ts)
`);
const _getContract        = db.prepare(`SELECT * FROM contracts WHERE id = ?`);
const _getContractByLead  = db.prepare(`SELECT * FROM contracts WHERE lead_id = ? ORDER BY signed_at DESC LIMIT 1`);
const _markContractEmailed = db.prepare(`UPDATE contracts SET email_sent = 1 WHERE id = ?`);

function getContract(id)          { return _getContract.get(id); }
function getContractByLead(lid)   { return _getContractByLead.get(lid); }
function markContractEmailed(id)  { return _markContractEmailed.run(id); }

function createContract({ id, lead_id, signed_name, ip_address, user_agent }) {
  const ts = now();
  insertContract.run({ id, lead_id, signed_name, ip_address: ip_address || null, user_agent: user_agent || null, signed_at: ts, ts });
  updateLeadStatus.run('contract_signed', ts, lead_id);
  return getContract(id);
}

// ── Applications ─────────────────────────────────────────────────────────────
const insertApplication = db.prepare(`
  INSERT INTO applications
    (id, lead_id, full_name, email, phone, address_line1, address_line2, city, state, zip, dob, ssn, submitted_at, created_at)
  VALUES
    (@id, @lead_id, @full_name, @email, @phone, @address_line1, @address_line2, @city, @state, @zip, @dob, @ssn, @ts, @ts)
`);
const _getApplication        = db.prepare(`SELECT * FROM applications WHERE id = ?`);
const _getApplicationByLead  = db.prepare(`SELECT * FROM applications WHERE lead_id = ? ORDER BY submitted_at DESC LIMIT 1`);

function getApplication(id)         { return _getApplication.get(id); }
function getApplicationByLead(lid)  { return _getApplicationByLead.get(lid); }

function createApplication(fields) {
  const ts = now();
  // SENSITIVE: encrypt SSN and DOB before storage
  const ssn = encrypt(fields.ssn);
  const dob = encrypt(fields.dob);
  insertApplication.run({ ...fields, ssn, dob, ts });
  updateLeadStatus.run('application_submitted', ts, fields.lead_id);
  const row = getApplication(fields.id);
  // Never return decrypted SSN from this function
  return { ...row, ssn: '[PROTECTED]', dob: '[PROTECTED]' };
}

// ── Monitoring submissions ─────────────────────────────────────────────────────
const insertMonitoring = db.prepare(`
  INSERT INTO monitoring_submissions
    (id, lead_id, provider, username, mon_password, security_notes, submitted_at, created_at)
  VALUES
    (@id, @lead_id, @provider, @username, @mon_password, @security_notes, @ts, @ts)
`);
const _getMonitoring = db.prepare(`SELECT * FROM monitoring_submissions WHERE id = ?`);
function getMonitoring(id) { return _getMonitoring.get(id); }

function createMonitoringSubmission(fields) {
  const ts = now();
  // SENSITIVE: encrypt username and password before storage
  const username = encrypt(fields.username);
  const mon_password = encrypt(fields.password);
  insertMonitoring.run({
    id: fields.id,
    lead_id: fields.lead_id,
    provider: fields.provider,
    username,
    mon_password,
    security_notes: fields.security_notes || null,
    ts,
  });
  updateLeadStatus.run('monitoring_submitted', ts, fields.lead_id);
  return getMonitoring(fields.id);
}

// ── Email events ──────────────────────────────────────────────────────────────
const insertEmailEvent = db.prepare(`
  INSERT INTO email_events (id, lead_id, event_type, recipient, status, created_at)
  VALUES (@id, @lead_id, @event_type, @recipient, 'queued', @ts)
`);
const updateEmailEvent = db.prepare(`
  UPDATE email_events SET status = @status, error = @error, sent_at = @sent_at WHERE id = @id
`);

function logEmailEvent({ id, lead_id, event_type, recipient }) {
  insertEmailEvent.run({ id, lead_id, event_type, recipient, ts: now() });
}
function updateEmail({ id, status, error }) {
  updateEmailEvent.run({ id, status, error: error || null, sent_at: status === 'sent' ? now() : null });
}

// ── Review queue ──────────────────────────────────────────────────────────────
const insertReview = db.prepare(`
  INSERT INTO review_queue (id, lead_id, status, created_at, updated_at)
  VALUES (@id, @lead_id, 'awaiting_analysis', @ts, @ts)
`);
const _getReviewByLead = db.prepare(`SELECT * FROM review_queue WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1`);
function getReviewByLead(lid) { return _getReviewByLead.get(lid); }

function enqueueReview({ id, lead_id }) {
  const ts = now();
  insertReview.run({ id, lead_id, ts });
  updateLeadStatus.run('in_review', ts, lead_id);
  return getReviewByLead(lead_id);
}

// ── Users ─────────────────────────────────────────────────────────────────────
const insertUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, first_name, last_name, phone, created_at, updated_at)
  VALUES (@id, @email, @password_hash, @first_name, @last_name, @phone, @ts, @ts)
`);
const _getUserById    = db.prepare(`SELECT * FROM users WHERE id = ?`);
const _getUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const _updateUser     = db.prepare(`UPDATE users SET first_name=@first_name, last_name=@last_name, phone=@phone, updated_at=@ts WHERE id=@id`);

function getUserById(id)    { return _getUserById.get(id); }
function getUserByEmail(em) { return _getUserByEmail.get(em); }
function updateUser(fields) { return _updateUser.run({ ...fields, ts: now() }); }

function createUser({ id, email, password_hash, first_name, last_name, phone }) {
  const ts = now();
  insertUser.run({ id, email, password_hash, first_name: first_name || null, last_name: last_name || null, phone: phone || null, ts });
  return getUserById(id);
}

// ── Invite tokens ─────────────────────────────────────────────────────────────
const _setInviteToken       = db.prepare(`UPDATE users SET invite_token=@token, invite_expires=@expires, invite_used=0, updated_at=@ts WHERE id=@id`);
const _getUserByInviteToken = db.prepare(`SELECT * FROM users WHERE invite_token = ? AND invite_used = 0 AND invite_expires > ?`);
const _consumeInvite        = db.prepare(`UPDATE users SET password_hash=@password_hash, invite_used=1, invite_token=NULL, must_change_password=0, updated_at=@ts WHERE id=@id`);

function setInviteToken(user_id, token, expiresAt) {
  _setInviteToken.run({ id: user_id, token, expires: expiresAt, ts: now() });
}
function getUserByInviteToken(token) {
  return _getUserByInviteToken.get(token, new Date().toISOString());
}
function consumeInvite(user_id, password_hash) {
  _consumeInvite.run({ id: user_id, password_hash, ts: now() });
}

// ── Disputes ──────────────────────────────────────────────────────────────────
const insertDispute = db.prepare(`
  INSERT INTO disputes (id, user_id, account_name, account_number, bureau, reason, request, notes, status, priority, generated_letter, created_at, updated_at)
  VALUES (@id, @user_id, @account_name, @account_number, @bureau, @reason, @request, @notes, 'drafted', @priority, @generated_letter, @ts, @ts)
`);
const _getDisputesByUser    = db.prepare(`SELECT * FROM disputes WHERE user_id = ? ORDER BY created_at DESC`);
const _getDisputeById       = db.prepare(`SELECT * FROM disputes WHERE id = ?`);
const _deleteDisputesByUser = db.prepare(`DELETE FROM disputes WHERE user_id = ?`);

function getDisputesByUser(uid)    { return _getDisputesByUser.all(uid); }
function deleteDisputesByUser(uid) { return _deleteDisputesByUser.run(uid); }

function createDispute({ id, user_id, account_name, account_number, bureau, reason, request, notes, priority, generated_letter }) {
  const ts = now();
  insertDispute.run({ id, user_id, account_name, account_number: account_number || null, bureau, reason: reason || null, request: request || null, notes: notes || null, priority: priority || 'medium', generated_letter: generated_letter || null, ts });
  return _getDisputeById.get(id);
}

// ── Documents ─────────────────────────────────────────────────────────────────
const insertDocument    = db.prepare(`
  INSERT INTO user_documents (id, user_id, name, file_name, size, content_type, doc_type, created_at)
  VALUES (@id, @user_id, @name, @file_name, @size, @content_type, @doc_type, @ts)
`);
const _getDocumentsByUser = db.prepare(`SELECT * FROM user_documents WHERE user_id = ? ORDER BY created_at DESC`);
function getDocumentsByUser(uid) { return _getDocumentsByUser.all(uid); }

function createDocument({ id, user_id, name, file_name, size, content_type, doc_type }) {
  const ts = now();
  insertDocument.run({ id, user_id, name, file_name: file_name || null, size: size || 0, content_type: content_type || null, doc_type: doc_type || 'other', ts });
  return { id, user_id, name, file_name, doc_type, created_at: ts };
}

// ── Admin queries ─────────────────────────────────────────────────────────────
const _getAllUsers = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`);
const _setUserRole = db.prepare(`UPDATE users SET role=@role, updated_at=@ts WHERE id=@id`);
const _getReviewQueue = db.prepare(`
  SELECT rq.*, l.full_name, l.email, l.phone, l.status as lead_status
  FROM review_queue rq
  LEFT JOIN leads l ON rq.lead_id = l.id
  ORDER BY rq.created_at DESC
  LIMIT 100
`);
const _getDisputeCountByUser = db.prepare(`SELECT COUNT(*) as cnt FROM disputes WHERE user_id=?`);
const _statsLeads    = db.prepare(`SELECT COUNT(*) as cnt FROM leads`);
const _statsUsers    = db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role='client'`);
const _statsReview   = db.prepare(`SELECT COUNT(*) as cnt FROM review_queue WHERE status='awaiting_analysis'`);
const _statsDisputes = db.prepare(`SELECT COUNT(*) as cnt FROM disputes`);

function setUserRole(userId, role) {
  _setUserRole.run({ id: userId, role, ts: now() });
}
function getReviewQueue() {
  return _getReviewQueue.all();
}
function getAdminStats() {
  return {
    totalLeads:      _statsLeads.get().cnt,
    totalClients:    _statsUsers.get().cnt,
    awaitingReview:  _statsReview.get().cnt,
    totalDisputes:   _statsDisputes.get().cnt,
  };
}
function getAllClientsWithStatus() {
  const users = _getAllUsers.all();
  return users.filter(u => u.role === 'client').map(u => {
    const lead      = _getLeadByEmail.get(u.email);
    const analysis  = _getAnalysisByUser.get(u.id);
    const dispCount = _getDisputeCountByUser.get(u.id)?.cnt || 0;
    const wf = analysis?.workflow ? JSON.parse(analysis.workflow) : null;
    const an = analysis?.analysis  ? JSON.parse(analysis.analysis) : null;
    const { password_hash, invite_token, ...safeUser } = u;
    const pmt = _getPaymentByUser.get(u.id);
    return {
      ...safeUser,
      lead_status:     lead?.status || null,
      lead_id:         lead?.id     || null,
      workflow_stage:  wf?.stage    || null,
      analysis_status: an?.status   || null,
      dispute_count:   dispCount,
      payment_status:  pmt?.status  || 'none',
    };
  });
}

// ── Analysis (per-user credit analysis cache) ─────────────────────────────────
const upsertAnalysis = db.prepare(`
  INSERT INTO user_analysis (id, user_id, analysis, dispute_strategy, workflow, updated_at)
  VALUES (@id, @user_id, @analysis, @dispute_strategy, @workflow, @ts)
  ON CONFLICT(user_id) DO UPDATE SET analysis=@analysis, dispute_strategy=@dispute_strategy, workflow=@workflow, updated_at=@ts
`);
const _getAnalysisByUser = db.prepare(`SELECT * FROM user_analysis WHERE user_id = ?`);

function saveAnalysis({ id, user_id, analysis, dispute_strategy, workflow }) {
  const ts = now();
  upsertAnalysis.run({ id, user_id, analysis: JSON.stringify(analysis), dispute_strategy: JSON.stringify(dispute_strategy), workflow: JSON.stringify(workflow), ts });
  return _getAnalysisByUser.get(user_id);
}
function getAnalysis(user_id) {
  const row = _getAnalysisByUser.get(user_id);
  if (!row) return null;
  return {
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
    dispute_strategy: row.dispute_strategy ? JSON.parse(row.dispute_strategy) : null,
    workflow: row.workflow ? JSON.parse(row.workflow) : null,
  };
}

// ── Payments ──────────────────────────────────────────────────────────────────
const _getPaymentByUser   = db.prepare(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`);
const _getPaymentBySubId  = db.prepare(`SELECT * FROM payments WHERE stripe_subscription_id = ? LIMIT 1`);
const _getPaymentByCustId = db.prepare(`SELECT * FROM payments WHERE stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1`);
const _getPaymentBySession = db.prepare(`SELECT * FROM payments WHERE stripe_session_id = ? LIMIT 1`);

const _insertPayment = db.prepare(`
  INSERT INTO payments (id, user_id, stripe_customer_id, stripe_subscription_id, stripe_session_id, status, plan, amount_cents, current_period_end, cancel_at_period_end, created_at, updated_at)
  VALUES (@id, @user_id, @stripe_customer_id, @stripe_subscription_id, @stripe_session_id, @status, @plan, @amount_cents, @current_period_end, @cancel_at_period_end, @ts, @ts)
`);
const _updatePaymentStatus = db.prepare(`
  UPDATE payments SET stripe_customer_id=@stripe_customer_id, stripe_subscription_id=@stripe_subscription_id, status=@status, plan=@plan, amount_cents=@amount_cents, current_period_end=@current_period_end, cancel_at_period_end=@cancel_at_period_end, updated_at=@ts WHERE id=@id
`);

function getPaymentByUser(user_id)    { return _getPaymentByUser.get(user_id); }
function getPaymentBySubId(subId)     { return _getPaymentBySubId.get(subId); }
function getPaymentByCustId(custId)   { return _getPaymentByCustId.get(custId); }
function getPaymentBySession(sessId)  { return _getPaymentBySession.get(sessId); }

function upsertPayment(fields) {
  const existing = _getPaymentByUser.get(fields.user_id);
  const ts = now();
  if (existing) {
    _updatePaymentStatus.run({
      id:                    existing.id,
      stripe_customer_id:    fields.stripe_customer_id    ?? existing.stripe_customer_id,
      stripe_subscription_id:fields.stripe_subscription_id ?? existing.stripe_subscription_id,
      status:                fields.status                ?? existing.status,
      plan:                  fields.plan                  ?? existing.plan,
      amount_cents:          fields.amount_cents          ?? existing.amount_cents,
      current_period_end:    fields.current_period_end    ?? existing.current_period_end,
      cancel_at_period_end:  fields.cancel_at_period_end  ?? existing.cancel_at_period_end ?? 0,
      ts,
    });
    return _getPaymentByUser.get(fields.user_id);
  }
  const id = require('uuid').v4();
  _insertPayment.run({
    id,
    user_id:               fields.user_id,
    stripe_customer_id:    fields.stripe_customer_id    || null,
    stripe_subscription_id:fields.stripe_subscription_id || null,
    stripe_session_id:     fields.stripe_session_id     || null,
    status:                fields.status                || 'none',
    plan:                  fields.plan                  || null,
    amount_cents:          fields.amount_cents          || null,
    current_period_end:    fields.current_period_end    || null,
    cancel_at_period_end:  fields.cancel_at_period_end  || 0,
    ts,
  });
  return _getPaymentByUser.get(fields.user_id);
}

module.exports = {
  db,
  createLead,       getLead,    getLeadByEmail,
  createContract,   getContract, getContractByLead, markContractEmailed,
  createApplication, getApplication, getApplicationByLead,
  createMonitoringSubmission,
  logEmailEvent,    updateEmail,
  enqueueReview,    getReviewByLead,
  // users
  createUser, getUserById, getUserByEmail, updateUser,
  setInviteToken, getUserByInviteToken, consumeInvite,
  // disputes
  createDispute, getDisputesByUser, deleteDisputesByUser,
  // documents
  createDocument, getDocumentsByUser,
  // analysis
  saveAnalysis, getAnalysis,
  // admin
  setUserRole, getReviewQueue, getAdminStats, getAllClientsWithStatus,
  // payments
  upsertPayment, getPaymentByUser, getPaymentBySubId, getPaymentByCustId, getPaymentBySession,
  ENCRYPT_ENABLED,
};
