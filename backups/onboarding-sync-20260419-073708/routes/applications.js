'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const db       = require('../db/database');
const { applicationRules, handleValidation } = require('../middleware/validate');

// POST /api/applications — save personal info (SSN, DOB encrypted at rest)
router.post('/', applicationRules, handleValidation, async (req, res) => {
  try {
    const {
      lead_id, full_name, email, phone,
      address_line1, address_line2, city, state, zip,
      dob, ssn,
    } = req.body;

    const lead = db.getLead(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Prevent duplicate submission — return existing if already submitted
    const existing = db.getApplicationByLead(lead_id);
    if (existing) {
      return res.json({ application_id: existing.id, existing: true });
    }

    // Normalize SSN to digits only for consistent encryption
    const normalizedSSN = ssn.replace(/\D/g, '');

    const app = db.createApplication({
      id: uuidv4(),
      lead_id,
      full_name,
      email,
      phone: phone || null,
      address_line1,
      address_line2: address_line2 || null,
      city,
      state: state.toUpperCase(),
      zip,
      dob,
      ssn: normalizedSSN,
    });

    res.status(201).json({ application_id: app.id });
  } catch (err) {
    console.error('[applications] POST error:', err);
    res.status(500).json({ error: 'Could not save application' });
  }
});

// GET /api/applications/lead/:lead_id — check if application exists
router.get('/lead/:lead_id', (req, res) => {
  const app = db.getApplicationByLead(req.params.lead_id);
  if (!app) return res.status(404).json({ submitted: false });
  // Never expose SSN or DOB — they're encrypted and flagged [PROTECTED] by the DB layer
  const { ssn, dob, ...safe } = app;
  res.json({ submitted: true, application: safe });
});

module.exports = router;
