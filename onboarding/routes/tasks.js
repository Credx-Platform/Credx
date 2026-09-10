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

// ── GET /api/tasks ───────────────────────────────────────────────────────────
// Admin: all tasks with client info. Client: only own tasks.
router.get('/', requireAuth, (req, res) => {
  try {
    if (req.userRole === 'admin') {
      const tasks = db.getAllTasks();
      // Enrich with user info
      const enriched = tasks.map(t => {
        const user = db.getUserById(t.user_id);
        return {
          ...t,
          client_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown',
          client_email: user?.email || '',
        };
      });
      return res.json({ tasks: enriched });
    }
    const tasks = db.getTasksByUser(req.userId);
    res.json({ tasks });
  } catch (err) {
    console.error('[tasks] GET error:', err);
    res.status(500).json({ error: 'Could not fetch tasks' });
  }
});

// ── GET /api/tasks/:id ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  try {
    const task = db.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.userRole !== 'admin' && task.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ task });
  } catch (err) {
    console.error('[tasks] GET by id error:', err);
    res.status(500).json({ error: 'Could not fetch task' });
  }
});

// ── POST /api/tasks ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const { user_id, title, description, category, priority, due_date } = req.body;
    if (!user_id || !title) {
      return res.status(400).json({ error: 'user_id and title are required' });
    }
    const user = db.getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'Client not found' });

    const task = db.createTask({
      id: uuidv4(),
      user_id,
      title,
      description,
      category: category || 'Dispute',
      priority: priority || 'medium',
      due_date: due_date || null,
      created_by: req.userEmail || 'admin',
    });
    res.status(201).json({ task });
  } catch (err) {
    console.error('[tasks] POST error:', err);
    res.status(500).json({ error: 'Could not create task' });
  }
});

// ── PUT /api/tasks/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAuth, (req, res) => {
  try {
    const existing = db.getTaskById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (req.userRole !== 'admin' && existing.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { title, description, category, priority, status, due_date } = req.body;
    const updated = db.updateTask({
      id: req.params.id,
      title: title ?? existing.title,
      description: description ?? existing.description,
      category: category ?? existing.category,
      priority: priority ?? existing.priority,
      status: status ?? existing.status,
      due_date: due_date ?? existing.due_date,
    });
    res.json({ task: updated });
  } catch (err) {
    console.error('[tasks] PUT error:', err);
    res.status(500).json({ error: 'Could not update task' });
  }
});

// ── PATCH /api/tasks/:id/toggle ──────────────────────────────────────────────
router.patch('/:id/toggle', requireAuth, (req, res) => {
  try {
    const existing = db.getTaskById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (req.userRole !== 'admin' && existing.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const newStatus = existing.status === 'completed' ? 'pending' : 'completed';
    const updated = db.toggleTaskStatus(req.params.id, newStatus);
    res.json({ task: updated });
  } catch (err) {
    console.error('[tasks] PATCH toggle error:', err);
    res.status(500).json({ error: 'Could not toggle task' });
  }
});

// ── DELETE /api/tasks/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const existing = db.getTaskById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    db.deleteTask(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[tasks] DELETE error:', err);
    res.status(500).json({ error: 'Could not delete task' });
  }
});

module.exports = router;
