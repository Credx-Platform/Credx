'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const db       = require('../db/database');
const mailer   = require('../email/mailer');
const { contractRules, handleValidation } = require('../middleware/validate');

const BIZ_NAME  = process.env.BUSINESS_NAME || 'The Malloy Group Financial LLC';
const SUPPORT   = process.env.SUPPORT_EMAIL  || 'support@credx.com';

// GET /api/contracts/text — return the full plain-text service agreement (for display)
router.get('/text', (req, res) => {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  res.json({ agreement: buildAgreementText(today) });
});

// POST /api/contracts — record e-signature, send confirmation emails
router.post('/', contractRules, handleValidation, async (req, res) => {
  try {
    const { lead_id, signed_name, agreed } = req.body;
    const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const user_agent = req.headers['user-agent'] || null;

    const lead = db.getLead(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Prevent duplicate signing
    const existing = db.getContractByLead(lead_id);
    if (existing) {
      return res.json({ contract_id: existing.id, signed_at: existing.signed_at, existing: true });
    }

    const contract = db.createContract({
      id: uuidv4(),
      lead_id,
      signed_name,
      ip_address,
      user_agent,
    });

    // Confirmation email to client
    mailer.sendSignedConfirmation({
      to: lead.email,
      name: lead.full_name,
      signedAt: contract.signed_at,
      signedName: signed_name,
      lead_id,
    }).catch(err => console.error('[contracts] confirmation email failed:', err.message));

    db.markContractEmailed(contract.id);

    res.status(201).json({
      contract_id: contract.id,
      signed_at: contract.signed_at,
    });
  } catch (err) {
    console.error('[contracts] POST error:', err);
    res.status(500).json({ error: 'Could not save contract' });
  }
});

// GET /api/contracts/lead/:lead_id — check if lead has signed
router.get('/lead/:lead_id', (req, res) => {
  const contract = db.getContractByLead(req.params.lead_id);
  if (!contract) return res.status(404).json({ signed: false });
  res.json({ signed: true, signed_at: contract.signed_at, signed_name: contract.signed_name });
});

module.exports = router;

// ── Agreement text ────────────────────────────────────────────────────────────
function buildAgreementText(date) {
  return `CREDX SERVICE AGREEMENT & DISCLOSURE PACKET
${BIZ_NAME}
Effective Date: ${date}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — PARTIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This Agreement is entered into between ${BIZ_NAME} ("Company," "we," or "us") and the individual completing this form ("Client" or "you").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — SERVICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Company will provide the following credit-related services on your behalf:

(a) Review of your consumer credit reports from one or more of the major credit reporting agencies (Equifax, Experian, TransUnion);
(b) Identification of potentially inaccurate, unverifiable, or outdated derogatory items;
(c) Preparation and submission of written dispute correspondence to credit bureaus and/or creditors, as legally permitted under the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq.;
(d) Ongoing monitoring of dispute responses and follow-up correspondence as warranted;
(e) Credit education, coaching, and strategy consultations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — IMPORTANT DISCLOSURES (REQUIRED BY LAW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pursuant to the Credit Repair Organizations Act (CROA), 15 U.S.C. § 1679 et seq., the Company is required to provide you with the following disclosures:

3.1  RIGHT TO CANCEL
You have the right to cancel this Agreement, without penalty or obligation, within THREE (3) BUSINESS DAYS of signing. To cancel, you must notify us in writing at: ${SUPPORT}

3.2  NO GUARANTEED RESULTS
The Company makes NO guarantee that your credit score will improve by any specific amount, that any specific item will be removed from your credit report, or that any particular outcome will be achieved. Credit repair results vary by individual and cannot be predicted.

3.3  YOUR RIGHTS UNDER THE FCRA
You have the right to dispute inaccurate information in your credit report directly with the credit bureaus at no charge. You are not required to hire a credit repair company to dispute inaccuracies on your behalf.

3.4  WE ARE NOT A LAW FIRM
${BIZ_NAME} is not a law firm and does not provide legal advice. Nothing in this Agreement constitutes legal advice. If you require legal counsel, you should consult a licensed attorney.

3.5  ADVANCE FEE PROHIBITION
Under the CROA, we may not charge or receive any fee before the agreed-upon services have been fully performed. Any payment schedule will be disclosed separately and will comply with applicable law.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — CLIENT RESPONSIBILITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To enable us to perform services, you agree to:

(a) Provide accurate and complete personal information, including name, address, Social Security Number, and date of birth;
(b) Provide access to your credit monitoring account(s) as requested;
(c) Promptly forward any correspondence you receive from credit bureaus or creditors regarding disputes;
(d) Refrain from opening new lines of credit, incurring new debt, or taking other actions that may negatively impact your credit profile without consulting us first;
(e) Notify us of any material changes to your financial situation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 5 — CONFIDENTIALITY & DATA SECURITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All personal information you provide — including SSN, date of birth, financial data, and credit monitoring credentials — is stored using industry-standard AES-256 encryption. We do not sell, rent, or share your personal information with third parties, except as required by law or as necessary to perform services on your behalf (e.g., submitting dispute letters).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 6 — LIMITATION OF LIABILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Company's total liability to you for any claim arising out of this Agreement shall not exceed the total fees paid by you to the Company during the preceding 30 days. The Company shall not be liable for any indirect, incidental, or consequential damages.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 7 — GOVERNING LAW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This Agreement shall be governed by the laws of the State of Florida, without regard to conflict-of-law principles. Any disputes shall be resolved in the courts of competent jurisdiction in Florida.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 8 — ENTIRE AGREEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This Agreement, together with any fee schedule provided separately, constitutes the entire agreement between the parties and supersedes all prior representations, understandings, or agreements.

By typing your name and checking the acknowledgment box below, you confirm that:
• You have read and understood this Agreement in its entirety;
• You agree to be bound by its terms;
• Your typed name constitutes your legal electronic signature;
• You understand you have 3 business days to cancel without penalty.`;
}
