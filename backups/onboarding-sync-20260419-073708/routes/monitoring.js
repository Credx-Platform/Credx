'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const router   = express.Router();

const db       = require('../db/database');
const mailer   = require('../email/mailer');
const { monitoringRules, handleValidation } = require('../middleware/validate');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// POST /api/monitoring — save credit monitoring credentials (encrypted)
router.post('/', monitoringRules, handleValidation, async (req, res) => {
  try {
    const { lead_id, provider, username, password, security_notes } = req.body;

    const lead = db.getLead(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const submission = db.createMonitoringSubmission({
      id: uuidv4(),
      lead_id,
      provider,
      username,
      password,
      security_notes: security_notes || null,
    });

    res.status(201).json({ submission_id: submission.id });
  } catch (err) {
    console.error('[monitoring] POST error:', err);
    res.status(500).json({ error: 'Could not save monitoring credentials' });
  }
});

// POST /api/monitoring/complete — mark onboarding done, trigger final emails + review queue
router.post('/complete', async (req, res) => {
  try {
    const { lead_id } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const lead = db.getLead(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Enqueue for staff review
    const review = db.enqueueReview({ id: uuidv4(), lead_id });

    // Completion email to client
    mailer.sendOnboardingComplete({
      to: lead.email,
      name: lead.full_name,
      lead_id,
    }).catch(err => console.error('[monitoring] completion email failed:', err.message));

    // Staff alert
    mailer.sendStaffAlert({
      name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      leadId: lead_id,
    }).catch(err => console.error('[monitoring] staff alert failed:', err.message));

    // ── Create portal account + send invite ───────────────────────────────────
    // Idempotent: skip if a portal user already exists for this email
    const existingUser = db.getUserByEmail(lead.email);
    if (!existingUser) {
      try {
        // Placeholder hash — replaced when client accepts the invite
        const placeholderHash = await bcrypt.hash(uuidv4(), 10);
        const nameParts = lead.full_name.trim().split(/\s+/);
        const newUser = db.createUser({
          id:            uuidv4(),
          email:         lead.email,
          password_hash: placeholderHash,
          first_name:    nameParts[0] || null,
          last_name:     nameParts.slice(1).join(' ') || null,
          phone:         lead.phone || null,
        });

        // Secure random invite token, expires 48 hours from now
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const expiresAt   = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        db.setInviteToken(newUser.id, inviteToken, expiresAt);

        const inviteUrl = `${APP_URL}/portal/activate?token=${inviteToken}`;

        mailer.sendPortalInvite({
          to:       lead.email,
          name:     lead.full_name,
          inviteUrl,
          lead_id,
        }).catch(err => console.error('[monitoring] portal invite email failed:', err.message));
      } catch (err) {
        // Non-fatal — log and continue; staff can manually invite
        console.error('[monitoring] portal account creation failed:', err.message);
      }
    }

    res.json({ success: true, review_id: review.id });
  } catch (err) {
    console.error('[monitoring] complete error:', err);
    res.status(500).json({ error: 'Could not complete onboarding' });
  }
});

module.exports = router;
