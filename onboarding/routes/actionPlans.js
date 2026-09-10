'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router  = express.Router();

const db = require('../db/database');
const { requireAuth } = require('./auth');

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── GET /api/action-plans ────────────────────────────────────────────────────
// Admin: all action plans with client info. Client: only own action plans.
router.get('/', requireAuth, (req, res) => {
  try {
    if (req.userRole === 'admin') {
      const plans = db.getAllActionPlans();
      // Enrich with user info
      const enriched = plans.map(p => {
        const user = db.getUserById(p.user_id);
        return {
          ...p,
          client_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown',
          client_email: user?.email || '',
        };
      });
      return res.json({ action_plans: enriched });
    }
    const plans = db.getActionPlansByUser(req.userId);
    res.json({ action_plans: plans });
  } catch (err) {
    console.error('[action-plans] GET error:', err);
    res.status(500).json({ error: 'Could not fetch action plans' });
  }
});

// ── GET /api/action-plans/:id ────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  try {
    const plan = db.getActionPlanById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Action plan not found' });
    if (req.userRole !== 'admin' && plan.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ action_plan: plan });
  } catch (err) {
    console.error('[action-plans] GET by id error:', err);
    res.status(500).json({ error: 'Could not fetch action plan' });
  }
});

// ── POST /api/action-plans ───────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const { user_id, title, description, status, priority, due_date } = req.body;
    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }
    const user = db.getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'Client not found' });

    const plan = db.createActionPlan({
      id: uuidv4(),
      user_id,
      title,
      description,
      status: status || 'active',
      priority: priority || 'medium',
      due_date: due_date || null,
      created_by: req.userEmail || 'admin',
    });
    res.status(201).json({ action_plan: plan });
  } catch (err) {
    console.error('[action-plans] POST error:', err);
    res.status(500).json({ error: 'Could not create action plan' });
  }
});

// ── PUT /api/action-plans/:id ────────────────────────────────────────────────
router.put('/:id', requireAuth, (req, res) => {
  try {
    const existing = db.getActionPlanById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Action plan not found' });
    if (req.userRole !== 'admin' && existing.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { title, description, status, priority, due_date } = req.body;
    const updated = db.updateActionPlan({
      id: req.params.id,
      title: title ?? existing.title,
      description: description ?? existing.description,
      status: status ?? existing.status,
      priority: priority ?? existing.priority,
      due_date: due_date ?? existing.due_date,
    });
    res.json({ action_plan: updated });
  } catch (err) {
    console.error('[action-plans] PUT error:', err);
    res.status(500).json({ error: 'Could not update action plan' });
  }
});

// ── PATCH /api/action-plans/:id/toggle ───────────────────────────────────────
router.patch('/:id/toggle', requireAuth, (req, res) => {
  try {
    const existing = db.getActionPlanById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Action plan not found' });
    if (req.userRole !== 'admin' && existing.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const newStatus = existing.status === 'completed' ? 'active' : 'completed';
    const updated = db.toggleActionPlanStatus(req.params.id, newStatus);
    res.json({ action_plan: updated });
  } catch (err) {
    console.error('[action-plans] PATCH toggle error:', err);
    res.status(500).json({ error: 'Could not toggle action plan' });
  }
});

// ── DELETE /api/action-plans/:id ─────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const existing = db.getActionPlanById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Action plan not found' });
    db.deleteActionPlan(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[action-plans] DELETE error:', err);
    res.status(500).json({ error: 'Could not delete action plan' });
  }
});

module.exports = router;
