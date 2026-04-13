'use strict';
/**
 * routes/payments.js — Stripe payment integration for CredX
 *
 * Endpoints:
 *   POST /api/payments/create-checkout  — Create Stripe Checkout session
 *   POST /api/payments/webhook          — Stripe webhook (raw body, no auth)
 *   GET  /api/payments/status           — Current user payment status
 *   POST /api/payments/billing-portal   — Stripe Customer Portal session
 *
 * Setup:
 *   1. Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET to .env
 *   2. Create products/prices in Stripe Dashboard and add price IDs to .env
 *   3. Register webhook at https://dashboard.stripe.com/webhooks pointing to
 *      https://credxme.com/api/payments/webhook with events:
 *        checkout.session.completed
 *        customer.subscription.updated
 *        customer.subscription.deleted
 *        invoice.payment_failed
 *        invoice.paid
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('./auth');

const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY     || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_MONTHLY  = process.env.STRIPE_PRICE_MONTHLY  || '';
const STRIPE_PRICE_SETUP    = process.env.STRIPE_PRICE_SETUP    || '';
const APP_URL               = process.env.APP_URL || 'https://credxme.com';

// Lazy-load Stripe so the server still starts without a valid key (during config)
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.startsWith('sk_test_REPLACE')) {
      throw new Error('STRIPE_SECRET_KEY is not configured. Add it to .env');
    }
    _stripe = require('stripe')(STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// ── POST /api/payments/create-checkout ───────────────────────────────────────
router.post('/create-checkout', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const user   = db.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Build line items — setup fee is optional (only if price ID configured)
    const lineItems = [];
    if (STRIPE_PRICE_SETUP && !STRIPE_PRICE_SETUP.startsWith('price_REPLACE')) {
      lineItems.push({ price: STRIPE_PRICE_SETUP, quantity: 1 });
    }
    if (!STRIPE_PRICE_MONTHLY || STRIPE_PRICE_MONTHLY.startsWith('price_REPLACE')) {
      return res.status(503).json({ error: 'Payment plans are not configured yet. Please contact support.' });
    }
    lineItems.push({ price: STRIPE_PRICE_MONTHLY, quantity: 1 });

    // Reuse existing Stripe customer if we have one
    const existingPayment = db.getPaymentByUser(req.userId);
    let customer = existingPayment?.stripe_customer_id || undefined;

    if (!customer) {
      const cust = await stripe.customers.create({
        email: user.email,
        name:  [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
        metadata: { credx_user_id: user.id },
      });
      customer = cust.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: lineItems,
      subscription_data: {
        metadata: { credx_user_id: user.id },
      },
      success_url: `${APP_URL}/portal?payment=success`,
      cancel_url:  `${APP_URL}/portal?payment=cancelled`,
      metadata:    { credx_user_id: user.id },
      customer_update: { address: 'auto' },
    });

    // Record pending checkout in DB
    db.upsertPayment({
      user_id:           user.id,
      stripe_customer_id: customer,
      stripe_session_id: session.id,
      status:            'pending',
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[payments] create-checkout error:', err.message);
    if (err.message.includes('not configured')) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// ── POST /api/payments/webhook — raw body, Stripe signature verification ──────
// NOTE: This route needs express.raw() middleware — mounted in server.js before express.json()
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET.startsWith('whsec_REPLACE')) {
    console.warn('[payments] webhook received but STRIPE_WEBHOOK_SECRET not configured');
    return res.status(200).json({ received: true });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[payments] webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[payments] webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

async function handleWebhookEvent(event) {
  const stripe = getStripe();
  const { type, data } = event;
  const obj = data.object;

  console.log(`[payments] webhook: ${type}`);

  switch (type) {

    case 'checkout.session.completed': {
      // Payment confirmed — activate subscription
      const userId = obj.metadata?.credx_user_id;
      if (!userId) break;
      const subId = obj.subscription;
      let sub = null;
      if (subId) sub = await stripe.subscriptions.retrieve(subId);

      db.upsertPayment({
        user_id:               userId,
        stripe_customer_id:    obj.customer,
        stripe_subscription_id: subId || null,
        stripe_session_id:     obj.id,
        status:                sub ? mapSubStatus(sub.status) : 'active',
        plan:                  'monthly',
        amount_cents:          sub?.items?.data?.[0]?.price?.unit_amount || null,
        current_period_end:    sub ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end:  sub?.cancel_at_period_end ? 1 : 0,
      });
      break;
    }

    case 'customer.subscription.updated': {
      const userId = obj.metadata?.credx_user_id;
      const rec    = userId ? null : db.getPaymentBySubId(obj.id);
      const uid    = userId || rec?.user_id;
      if (!uid) break;
      db.upsertPayment({
        user_id:               uid,
        stripe_customer_id:    obj.customer,
        stripe_subscription_id: obj.id,
        status:                mapSubStatus(obj.status),
        current_period_end:    new Date(obj.current_period_end * 1000).toISOString(),
        cancel_at_period_end:  obj.cancel_at_period_end ? 1 : 0,
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const rec = db.getPaymentBySubId(obj.id);
      if (!rec) break;
      db.upsertPayment({
        user_id:               rec.user_id,
        stripe_customer_id:    obj.customer,
        stripe_subscription_id: obj.id,
        status:                'canceled',
        cancel_at_period_end:  0,
      });
      break;
    }

    case 'invoice.paid': {
      // Keep period_end fresh on renewal
      const subId = obj.subscription;
      if (!subId) break;
      const rec = db.getPaymentBySubId(subId);
      if (!rec) break;
      const sub = await stripe.subscriptions.retrieve(subId);
      db.upsertPayment({
        user_id:            rec.user_id,
        status:             'active',
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case 'invoice.payment_failed': {
      const subId = obj.subscription;
      if (!subId) break;
      const rec = db.getPaymentBySubId(subId);
      if (!rec) break;
      db.upsertPayment({
        user_id: rec.user_id,
        status:  'past_due',
      });
      break;
    }

    default:
      // Ignore unhandled event types
      break;
  }
}

function mapSubStatus(stripeStatus) {
  const map = {
    active:            'active',
    trialing:          'trialing',
    past_due:          'past_due',
    canceled:          'canceled',
    unpaid:            'unpaid',
    incomplete:        'pending',
    incomplete_expired:'canceled',
    paused:            'paused',
  };
  return map[stripeStatus] || stripeStatus;
}

// ── GET /api/payments/status ──────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => {
  const payment = db.getPaymentByUser(req.userId);
  if (!payment) {
    return res.json({ status: 'none', active: false });
  }
  const active = ['active', 'trialing'].includes(payment.status);
  res.json({
    status:              payment.status,
    active,
    plan:                payment.plan,
    current_period_end:  payment.current_period_end,
    cancel_at_period_end: !!payment.cancel_at_period_end,
  });
});

// ── POST /api/payments/billing-portal ─────────────────────────────────────────
router.post('/billing-portal', requireAuth, async (req, res) => {
  try {
    const stripe  = getStripe();
    const payment = db.getPaymentByUser(req.userId);
    if (!payment?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found. Please enroll first.' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer:   payment.stripe_customer_id,
      return_url: `${APP_URL}/portal`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[payments] billing-portal error:', err.message);
    if (err.message.includes('not configured')) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

module.exports = router;
