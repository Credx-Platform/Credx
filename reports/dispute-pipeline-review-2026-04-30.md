🧾 **CredX Dispute Pipeline Review**
*Thursday, April 30, 2026 — 9:30 PM CST*

---

**1. DISPUTE WORKFLOW READINESS: ⚠️ PARTIAL**

The dispute engine is structurally sound but operates on **demo/preset data only**:

- **Letter generation** ✅ — FCRA-compliant dispute letters auto-generated per bureau
- **Dispute CRUD** ✅ — `POST /api/disputes`, `GET /api/disputes`, seed-case endpoint for Sharon Galloway preset
- **Workflow stages** ✅ — 9-stage pipeline from "Credit Report Received" → "Case Completed"
- **Status tracking** ⚠️ — Only `drafted` status exists; no `sent`, `response_received`, `verified`, `deleted` state machine
- **Round tracking** ❌ — No `round_1`, `round_2`, `round_3` logic in DB schema or API
- **Deadline tracking** ❌ — No `due_date`, `bureau_response_deadline`, or 30-day FCRA countdown fields
- **Live disputes** ❌ — **ZERO** disputes in the database (confirmed via SQLite query)

**2. ADMIN PORTAL READINESS: ⚠️ FRONTEND RICH, BACKEND THIN**

- **Admin HTML** ✅ — Fully styled CRM with Overview, Leads, Clients, Pipeline, Disputes, Billing, Affiliates, Team, Settings views
- **Stats endpoint** ✅ — `GET /api/admin/stats` returns counts
- **Client detail** ✅ — `GET /api/admin/clients/:userId` returns user + lead + application (SSN/DOB redacted) + disputes + analysis + documents + payment
- **Workflow update** ✅ — `PUT /api/admin/clients/:userId/workflow` advances stage
- **Analysis update** ✅ — `PUT /api/admin/clients/:userId/analysis` merges advisor notes
- **Invite system** ✅ — Token-based portal activation (48hr expiry), email via SendGrid
- **Admin login** ⚠️ — Frontend expects `/auth/login` with `role: 'admin'` but backend login does NOT enforce role check; `requireAdmin` middleware checks `req.userRole` from JWT payload correctly
- **Data is demo** ❌ — All dashboard numbers (36 customers, 479 disputes, $4,125 revenue) are **hardcoded HTML**; admin.html loads `loadStats()` but falls back to demo data on API failure

**3. MISSING OR FRAGILE PROCESS STEPS:**

| # | Gap | Risk Level |
|---|-----|------------|
| A | **No live dispute dataset** | 🔴 HIGH |
| B | **No deadline/response tracking** | 🔴 HIGH |
| C | **No status state machine** | 🔴 HIGH |
| D | **No round progression** | 🔴 HIGH |
| E | **Admin client creation endpoint missing** | 🟡 MEDIUM |
| F | **Stripe keys are placeholders** | 🟡 MEDIUM |
| G | **No document upload backend** | 🟡 MEDIUM |
| H | **No task/reminder system** | 🟡 MEDIUM |
| I | **SMTP creds in .env plaintext** | 🟡 MEDIUM |
| J | **No backup/DR for SQLite** | 🟢 LOW |

**4. DEADLINE & TRACKING RISKS:**

- **FCRA 30-day clock** — Completely manual. No automated countdown, no escalation trigger at day 25, no "response overdue" flag.
- **Bureau response logging** — No table/schema for logging bureau responses per dispute.
- **Client communication log** — No record of letters mailed, certified mail tracking, or follow-up dates.
- **Payment tracking** — Stripe integration stubbed; `payments` table exists but no live subscription data.

**5. MOST IMPORTANT OPERATIONAL FIXES (Priority Order):**

**🔴 P1 — Build Real Dispute State Machine**
Add `status` enum: `drafted → sent → response_received → verified → deleted / updated / escalated`. Add `round` (int), `sent_at`, `response_due_date`, `bureau_response` fields to `disputes` table.

**🔴 P1 — Add Deadline Tracking Table**
Create `dispute_deadlines` table with `dispute_id`, `deadline_type` (fca_30day, mov_15day, cfpb_response), `due_date`, `status` (pending, met, missed).

**🟡 P2 — Implement Admin Client Creation**
The `POST /api/admin/clients` route is referenced in admin.html but missing from admin.js.

**🟡 P2 — Replace Stripe Placeholders**
Add real `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_SETUP` to environment.

**🟡 P2 — Secure .env**
Rotate SendGrid API key immediately (exposed in plaintext). Move secrets to Railway environment variables.

**🟢 P3 — Document Upload Backend**
Add `POST /api/progress/docs/upload` with multer or similar for actual file storage.

**🟢 P3 — Task/Reminder Backend**
Add `tasks` and `reminders` tables with CRUD APIs.

---

**Summary:** The CredX platform has a **solid foundation** — clean schema, good security practices (AES-256 for PII, JWT auth, role middleware), professional UI, and legally compliant letter templates. However, it is currently a **demo system with zero live dispute data**. The critical gap is the absence of a real dispute lifecycle (status rounds, deadlines, response tracking). Once that state machine is built, the rest is operational polish.

*Reviewed by CredX · The Malloy Group Financial LLC*
