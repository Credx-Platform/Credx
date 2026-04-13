'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const db       = require('../db/database');
const mailer   = require('../email/mailer');
const { leadRules, handleValidation } = require('../middleware/validate');

// POST /api/leads — capture initial lead, send ack email
router.post('/', leadRules, handleValidation, async (req, res) => {
  try {
    const { full_name, email, phone } = req.body;
    const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const user_agent = req.headers['user-agent'] || null;

    // Idempotency: if email already exists, return existing lead (don't re-create)
    const existing = db.getLeadByEmail(email);
    if (existing) {
      return res.json({ lead_id: existing.id, status: existing.status, existing: true });
    }

    const lead = db.createLead({
      id: uuidv4(),
      full_name,
      email,
      phone: phone || null,
      ip_address,
      user_agent,
    });

    // Fire-and-forget ack email — don't let email failure block the response
    mailer.sendLeadAck({ to: email, name: full_name, lead_id: lead.id }).catch(err =>
      console.error('[leads] ack email failed:', err.message)
    );

    res.status(201).json({ lead_id: lead.id, status: lead.status });
  } catch (err) {
    console.error('[leads] POST error:', err);
    res.status(500).json({ error: 'Could not create lead' });
  }
});

// GET /api/leads/:id — retrieve lead (used to resume onboarding)
router.get('/:id', (req, res) => {
  const lead = db.getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json({ lead });
});

module.exports = router;
