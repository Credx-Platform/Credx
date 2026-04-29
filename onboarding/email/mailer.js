'use strict';
/**
 * email/mailer.js — Transactional email wrapper for CredX onboarding.
 *
 * Reads SMTP config from environment variables.
 * Degrades gracefully if not configured (logs to console, does not crash).
 *
 * Required env vars for live email:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   EMAIL_FROM        — "CredX <support@credx.com>"
 *   SUPPORT_EMAIL     — reply-to / staff CC
 *   BUSINESS_NAME     — "The Malloy Group Financial LLC"
 *   APP_URL           — public URL of the onboarding app
 */

const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const FROM      = process.env.EMAIL_FROM      || 'CredX <noreply@credx.com>';
const SUPPORT   = process.env.SUPPORT_EMAIL   || '';
const BIZ_NAME  = process.env.BUSINESS_NAME   || 'The Malloy Group Financial LLC';
const APP_URL   = process.env.APP_URL         || 'http://localhost:3000';
const ONBOARD_URL = `${APP_URL.replace(/\/$/, '')}/onboard`;

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function send({ to, subject, html, text, attachments, lead_id, event_type }) {
  // Resolve transport at send-time so SMTP config changes or late env loading are picked up
  const transport = createTransport();
  if (!transport) {
    console.warn('[mailer] SMTP not configured — email not sent. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }

  const msg = {
    from: FROM,
    to,
    replyTo: SUPPORT || undefined,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
    attachments,
  };

  // Log to email_events audit table whenever lead_id + event_type are provided
  const eventId = (lead_id && event_type) ? uuidv4() : null;
  if (eventId) {
    db.logEmailEvent({ id: eventId, lead_id, event_type, recipient: to });
  }

  if (!transport) {
    console.log(`[mailer:PREVIEW] To: ${to} | Subject: ${subject}`);
    if (eventId) db.updateEmail({ id: eventId, status: 'sent', error: null });
    return { messageId: 'preview-no-smtp', preview: true };
  }

  try {
    const result = await transport.sendMail(msg);
    if (eventId) db.updateEmail({ id: eventId, status: 'sent', error: null });
    return { messageId: result.messageId };
  } catch (err) {
    console.error('[mailer] Send failed:', err.message);
    if (eventId) db.updateEmail({ id: eventId, status: 'failed', error: err.message });
    throw err;
  }
}

// ── Email templates ───────────────────────────────────────────────────────────

function layout(content) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:'Helvetica Neue',Arial,sans-serif;background:#0d1526;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#111c30;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
  .header{background:linear-gradient(135deg,#0f1f3d,#142040);padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,.08)}
  .logo-mark{display:inline-block;width:44px;height:44px;background:linear-gradient(135deg,#22d3ee,#3b82f6);border-radius:10px;line-height:44px;font-size:22px;font-weight:700;color:#fff;text-align:center;margin-bottom:12px}
  .header h1{color:#f1f5f9;margin:0;font-size:26px;letter-spacing:3px;font-family:Georgia,serif;font-weight:700}
  .header p{color:#8899b4;margin:4px 0 0;font-size:12px;letter-spacing:.5px}
  .body{padding:36px 40px;color:#cbd5e1;line-height:1.75;font-size:14px}
  .body h2{color:#f1f5f9;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:10px;margin-bottom:18px;font-family:Georgia,serif;font-size:20px}
  .body h3{color:#e2e8f0;font-size:15px;margin-top:0;margin-bottom:6px}
  .body p{margin:0 0 14px}
  .body strong{color:#f1f5f9}
  .body a{color:#22d3ee}
  .cta{display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0a0a0a;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:20px 0;letter-spacing:.3px}
  .footer{background:#0d1526;padding:20px 40px;text-align:center;font-size:11px;color:#4a5568;border-top:1px solid rgba(255,255,255,.06)}
  .notice{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:14px 16px;margin:20px 0;font-size:13px;color:#cbd5e1}
  .notice strong{color:#fbbf24}
  ol,ul{padding-left:20px}
  ol li,ul li{margin-bottom:6px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo-mark">C</div>
    <h1>CREDX</h1>
    <p>${BIZ_NAME}</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    &copy; ${new Date().getFullYear()} ${BIZ_NAME} &bull; All Rights Reserved<br>
    This email is for the named recipient only. If received in error, please disregard.<br>
    <em>This is not legal advice. CredX is not a law firm.</em>
  </div>
</div>
</body>
</html>`;
}

// 1. Lead received — welcome email explaining CredX and next steps
async function sendLeadAck({ to, name, lead_id }) {
  await send({
    to, lead_id, event_type: 'lead_ack',
    subject: `Welcome to CredX, ${name} — Here's What Happens Next`,
    html: layout(`
      <h2>Welcome to CredX, ${name}!</h2>
      <p>Thank you for taking the first step toward rebuilding your financial future. We're glad you reached out to <strong>${BIZ_NAME}</strong>, and we're ready to go to work for you.</p>

      <h3 style="color:#1a1f36;margin-top:24px;margin-bottom:8px">What Is CredX?</h3>
      <p>CredX is a professional credit restoration service that reviews your credit reports from all three major bureaus — <strong>Equifax, Experian, and TransUnion</strong> — and disputes inaccurate, unverifiable, or outdated negative items on your behalf. We work within your legal rights under the <em>Fair Credit Reporting Act (FCRA)</em> and the <em>Credit Repair Organizations Act (CROA)</em> to challenge what doesn't belong on your report.</p>
      <p>Our team handles the dispute letters, bureau follow-ups, and monitoring so you don't have to navigate the process alone.</p>

      <h3 style="color:#1a1f36;margin-top:24px;margin-bottom:8px">Your Next Steps</h3>
      <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
        <tr>
          <td style="padding:12px 8px;vertical-align:top;width:36px">
            <div style="width:28px;height:28px;background:#c9a84c;color:#1a1f36;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px">1</div>
          </td>
          <td style="padding:12px 8px">
            <strong>Review &amp; Sign Your Service Agreement</strong><br>
            <span style="color:#555">Our service agreement outlines everything we will do for you, your rights under federal law, the cancellation process, and our no-guarantee policy. No services begin until you sign.</span>
          </td>
        </tr>
        <tr style="background:#f9f9f9">
          <td style="padding:12px 8px;vertical-align:top">
            <div style="width:28px;height:28px;background:#c9a84c;color:#1a1f36;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px">2</div>
          </td>
          <td style="padding:12px 8px">
            <strong>Complete Your Client Profile</strong><br>
            <span style="color:#555">Provide your address, date of birth, and Social Security Number so we can pull your credit reports. All sensitive data is encrypted with AES-256.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 8px;vertical-align:top">
            <div style="width:28px;height:28px;background:#c9a84c;color:#1a1f36;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px">3</div>
          </td>
          <td style="padding:12px 8px">
            <strong>Set Up Credit Monitoring &amp; Share Access</strong><br>
            <span style="color:#555">Sign up for IdentityIQ or MyFreeScoreNow.com (we provide the links), then share your login credentials through our secure portal. This gives us live access to your three-bureau reports without a hard inquiry.</span>
          </td>
        </tr>
      </table>

      <a href="${ONBOARD_URL}" class="cta">Continue Your Onboarding &rarr;</a>

      <div class="notice">
        <strong>Your 3-Day Right to Cancel:</strong> Under the Credit Repair Organizations Act, you have the right to cancel your agreement within three (3) business days of signing — at no charge. We'll remind you of this when you sign.
      </div>
      <div class="notice">
        <strong>Privacy:</strong> Your information is encrypted, stored securely, and never sold or shared with third parties. We take data security seriously.
      </div>
      <p style="margin-top:20px">Questions before you get started? Reply to this email or contact us at <a href="mailto:${SUPPORT || 'support@credx.com'}">${SUPPORT || 'support@credx.com'}</a>. We're here to help.</p>
      <p style="color:#666;font-size:13px;margin-top:8px">— The CredX Team at ${BIZ_NAME}</p>
    `),
  });
}

// 2. Contract ready (same as ack — client continues in-flow, but email confirms)
async function sendContractReady({ to, name, lead_id }) {
  await send({
    to, lead_id, event_type: 'contract_ready',
    subject: 'CredX — Your Service Agreement is Ready to Sign',
    html: layout(`
      <h2>Action Required: Sign Your Service Agreement</h2>
      <p>Hi ${name},</p>
      <p>Your CredX service agreement and disclosure packet is ready for your review and signature.</p>
      <p>Please click below to review the agreement and continue your onboarding:</p>
      <a href="${ONBOARD_URL}" class="cta">Review & Sign Agreement</a>
      <div class="notice">
        <strong>Important:</strong> No credit repair services will begin until your signed agreement is on file.
        This agreement outlines your rights, our service scope, and our no-guarantee policy.
      </div>
    `),
  });
}

// 3. Signed contract confirmation with summary
async function sendSignedConfirmation({ to, name, signedAt, signedName, lead_id }) {
  await send({
    to, lead_id, event_type: 'contract_signed',
    subject: 'CredX — Your Signed Agreement Confirmation',
    html: layout(`
      <h2>Agreement Signed — Confirmation</h2>
      <p>Hi ${name},</p>
      <p>This email confirms that <strong>${BIZ_NAME}</strong> has received your signed CredX Service Agreement.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:8px;color:#666">Signed Name</td><td style="padding:8px;font-weight:bold">${signedName}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Date & Time</td><td style="padding:8px">${new Date(signedAt).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'full',timeStyle:'short'})} ET</td></tr>
      </table>
      <p>Please retain this confirmation for your records. A copy of the agreement terms is available upon request.</p>
      <p>Your next step is to complete the onboarding application:</p>
      <a href="${ONBOARD_URL}" class="cta">Complete My Application</a>
      <div class="notice">
        <strong>Your 3-Day Right to Cancel:</strong> Under the Credit Repair Organizations Act, you have the right to cancel this agreement within three (3) business days without any charge. To cancel, contact us in writing at <a href="mailto:${SUPPORT}">${SUPPORT || 'support@credx.com'}</a>.
      </div>
    `),
  });
}

// 4. Onboarding completed
async function sendOnboardingComplete({ to, name, lead_id }) {
  await send({
    to, lead_id, event_type: 'onboarding_complete',
    subject: 'CredX — Onboarding Complete! Your File is Under Review',
    html: layout(`
      <h2>Onboarding Complete!</h2>
      <p>Hi ${name},</p>
      <p>Congratulations — you've completed your CredX onboarding. Your file has been submitted and is now in our <strong>internal review queue</strong>.</p>
      <h3 style="color:#1a1f36">What Happens Next</h3>
      <ol style="padding-left:20px;line-height:2">
        <li>Our team reviews your credit monitoring data and application</li>
        <li>We prepare your personalized credit analysis and strategy</li>
        <li>A CredX advisor will contact you to walk through your results</li>
        <li>If you choose to proceed, payment and service setup follows</li>
      </ol>
      <div class="notice">
        <strong>Timeline:</strong> Initial review typically takes 3–5 business days. You will be contacted via email and phone.
      </div>
      <p>Questions? Contact us at <a href="mailto:${SUPPORT}">${SUPPORT || 'support@credx.com'}</a>.</p>
    `),
  });
}

// 5. Internal staff alert
async function sendStaffAlert({ name, email, phone, leadId }) {
  if (!SUPPORT) return;
  await send({
    to: SUPPORT, lead_id: leadId, event_type: 'staff_alert',
    subject: `[CredX] New Completed Onboarding: ${name}`,
    html: layout(`
      <h2>New Onboarding Completed</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px;color:#666">Name</td><td style="padding:8px;font-weight:bold">${name}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Email</td><td style="padding:8px">${email}</td></tr>
        <tr><td style="padding:8px;color:#666">Phone</td><td style="padding:8px">${phone || '—'}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Lead ID</td><td style="padding:8px;font-family:monospace">${leadId}</td></tr>
        <tr><td style="padding:8px;color:#666">Submitted</td><td style="padding:8px">${new Date().toLocaleString()}</td></tr>
      </table>
      <p>Log in to review this file in the admin queue.</p>
    `),
  });
}

// 6. Portal invitation — sent after onboarding completes, account is created
async function sendPortalInvite({ to, name, inviteUrl, lead_id }) {
  await send({
    to, lead_id, event_type: 'portal_invite',
    subject: 'CredX — Set Up Your Client Portal Access',
    html: layout(`
      <h2>Your CredX Client Portal is Ready</h2>
      <p>Hi ${name},</p>
      <p>Your onboarding is complete and your CredX client file is in review. We've created your secure client portal account so you can track dispute progress, view advisor updates, and monitor your credit journey in real time.</p>

      <p>Click the button below to set your portal password and activate your account. <strong>This link expires in 48 hours.</strong></p>

      <a href="${inviteUrl}" class="cta">Activate My Portal Account &rarr;</a>

      <div class="notice">
        <strong>What you can do in the portal:</strong><br>
        &bull; Track the status of your disputes across all three bureaus<br>
        &bull; View messages and updates from your CredX advisor<br>
        &bull; Upload documents (ID, proof of address, etc.)<br>
        &bull; Monitor changes to your credit profile over time
      </div>

      <div class="notice notice-red">
        <strong>Security:</strong> This link is unique to you and should not be shared. If you did not create a CredX account, please contact us immediately at <a href="mailto:${SUPPORT || 'support@credx.com'}">${SUPPORT || 'support@credx.com'}</a>.
      </div>

      <p style="color:#666;font-size:13px">If the button above doesn't work, copy and paste this link into your browser:<br>
      <span style="font-family:monospace;word-break:break-all">${inviteUrl}</span></p>

      <p>— The CredX Team at ${BIZ_NAME}</p>
    `),
  });
}

// 7. Staff alert — credit report uploaded, analysis seeded, advisor action needed
async function sendReportUploadAlert({ clientName, clientEmail, userId, docName, lead_id }) {
  if (!SUPPORT) return;
  await send({
    to: SUPPORT, lead_id, event_type: 'report_upload_alert',
    subject: `[CredX] Credit Report Uploaded — Action Required: ${clientName}`,
    html: layout(`
      <h2>Credit Report Uploaded — Advisor Review Required</h2>
      <p>A client has uploaded their credit report. The analysis workspace has been seeded and is ready for your review.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
        <tr><td style="padding:8px;color:#666;width:140px">Client Name</td><td style="padding:8px;font-weight:bold">${clientName}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Email</td><td style="padding:8px">${clientEmail}</td></tr>
        <tr><td style="padding:8px;color:#666">User ID</td><td style="padding:8px;font-family:monospace;font-size:12px">${userId}</td></tr>
        <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Document</td><td style="padding:8px">${docName}</td></tr>
        <tr><td style="padding:8px;color:#666">Uploaded</td><td style="padding:8px">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })} ET</td></tr>
      </table>
      <div class="notice">
        <strong>Next step:</strong> Log in to the CredX advisor dashboard, open this client's dispute workspace, and complete the credit analysis — scores, derogatory findings, and Round 1 dispute targets.
      </div>
      <div class="notice notice-red">
        <strong>Action required within 3&ndash;5 business days</strong> to maintain the timeline commitment made to the client at onboarding.
      </div>
    `),
  });
}

module.exports = {
  sendLeadAck,
  sendContractReady,
  sendSignedConfirmation,
  sendOnboardingComplete,
  sendStaffAlert,
  sendPortalInvite,
  sendReportUploadAlert,
};
