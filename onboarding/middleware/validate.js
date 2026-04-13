'use strict';
const { body, validationResult } = require('express-validator');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
}

const leadRules = [
  body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).trim().isMobilePhone('any', { strictMode: false }).withMessage('Invalid phone number'),
];

const contractRules = [
  body('lead_id').trim().notEmpty().withMessage('lead_id is required'),
  body('signed_name').trim().notEmpty().withMessage('Signed name is required').isLength({ max: 120 }),
  body('agreed').isBoolean().equals('true').withMessage('You must agree to the terms'),
];

const applicationRules = [
  body('lead_id').trim().notEmpty().withMessage('lead_id is required'),
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
  body('email').trim().isEmail().normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('address_line1').trim().notEmpty().withMessage('Address is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().isLength({ min: 2, max: 2 }).withMessage('State must be 2-letter code'),
  body('zip').trim().matches(/^\d{5}(-\d{4})?$/).withMessage('Valid ZIP code required'),
  body('dob').trim().notEmpty().withMessage('Date of birth is required')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('DOB must be YYYY-MM-DD'),
  body('ssn').trim().notEmpty().withMessage('SSN is required')
    .matches(/^\d{3}-?\d{2}-?\d{4}$/).withMessage('SSN must be 9 digits'),
];

const monitoringRules = [
  body('lead_id').trim().notEmpty().withMessage('lead_id is required'),
  body('provider').trim().notEmpty().withMessage('Provider is required'),
  body('username').trim().notEmpty().withMessage('Username/email is required'),
  body('password').trim().notEmpty().withMessage('Password is required'),
  body('security_notes').optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
];

module.exports = {
  handleValidation,
  leadRules,
  contractRules,
  applicationRules,
  monitoringRules,
};
