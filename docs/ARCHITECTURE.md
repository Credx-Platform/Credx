# CredX Architecture Document

## System Overview

CredX is a Node.js/Express-based onboarding and client management platform with the following architecture:

### Current Stack
- **Runtime**: Node.js v20+ with Express.js
- **Database**: SQLite (better-sqlite3) — single-file, serverless
- **Authentication**: JWT (jsonwebtoken) + bcryptjs
- **Payments**: Stripe (subscriptions, webhooks)
- **Email**: Nodemailer (SendGrid via SMTP)
- **Frontend**: Static HTML/CSS/JS (SPA-style)
- **Deployment**: Railway (Docker-based)
- **Security**: Helmet.js, CORS, express-validator

### Repository Structure

```
credx-platform/
├── onboarding/                 # Main application
│   ├── server.js              # Express entry point
│   ├── package.json           # Dependencies
│   ├── db/
│   │   └── database.js        # SQLite schema + queries
│   ├── routes/
│   │   ├── auth.js            # JWT auth, register, login
│   │   ├── admin.js           # Admin dashboard API
│   │   ├── payments.js        # Stripe integration
│   │   ├── disputes.js        # Dispute case management
│   │   ├── progress.js        # Client progress tracking
│   │   ├── leads.js           # Lead capture
│   │   ├── tasks.js           # Task management (NEW)
│   │   ├── monitoring.js      # System monitoring
│   │   ├── myfreescorenow.js  # MFSN integration
│   │   ├── contracts.js       # Contract management
│   │   └── applications.js    # Service applications
│   ├── public/                # Static frontend
│   │   ├── index.html         # Homepage
│   │   ├── portal.html        # Client portal
│   │   ├── admin.html         # Admin dashboard
│   │   ├── login.html         # Login page
│   │   └── activate.html      # Account activation
│   ├── middleware/
│   │   └── validate.js        # Validation helpers
│   ├── lib/                   # Utilities
│   │   ├── pdfParser.js
│   │   ├── htmlParser.js
│   │   ├── imageParser.js
│   │   └── mfsnClient.js
│   └── email/
│       └── mailer.js          # Email service
├── agents/                    # Python AI agents (legacy)
├── docker/                    # Docker configs
├── scripts/                   # Utility scripts
└── docs/                      # Documentation (this dir)
```

### Database Schema (SQLite)

Current tables:
- `users` — accounts, auth, roles
- `leads` — captured leads
- `disputes` — dispute cases
- `payments` — Stripe payment records
- `progress` — client onboarding progress
- `tasks` — task management (NEW, uncommitted)

### API Routes

| Route | Description | Auth |
|-------|-------------|------|
| POST /api/auth/register | User registration | Public |
| POST /api/auth/login | User login | Public |
| GET /api/auth/me | Current user | JWT |
| POST /api/auth/accept-invite | Accept invitation | Public |
| GET /api/admin/stats | Admin statistics | Admin JWT |
| GET /api/admin/clients | Client list | Admin JWT |
| GET /api/admin/disputes | Dispute list | Admin JWT |
| POST /api/payments/checkout | Stripe checkout | JWT |
| POST /api/payments/webhook | Stripe webhooks | Stripe sig |
| GET /api/disputes | User disputes | JWT |
| POST /api/disputes | Create dispute | JWT |
| GET /api/progress | User progress | JWT |
| POST /api/progress | Update progress | JWT |
| GET /api/tasks | Task list | JWT |
| POST /api/tasks | Create task | Admin JWT |
| PUT /api/tasks/:id | Update task | JWT |
| DELETE /api/tasks/:id | Delete task | Admin JWT |

### Authentication Flow

1. User registers → creates account with bcrypt-hashed password
2. JWT token issued (30-day expiry)
3. Token stored client-side (localStorage)
4. Bearer token sent with each request
5. Role-based access: `user`, `admin`

### Known Issues

1. **Production auth 500 errors** — Login/register failing in production
2. **Admin endpoints 404** — Stats/clients not accessible in production
3. **SQLite in production** — Not suitable for concurrent multi-user SaaS
4. **No connection pooling** — Single SQLite file
5. **No Redis** — No caching or queueing
6. **No rate limiting** — Vulnerable to abuse
7. **No observability** — No error tracking or monitoring
8. **No automated backups** — Critical risk
9. **Task system incomplete** — Routes created but not fully wired
10. **CORS configuration** — May be too permissive

### Infrastructure

- **Primary hosting**: Railway (Docker)
- **Domain**: credxme.com
- **API domain**: api.credxme.com (or Railway domain)
- **Database**: SQLite file (single instance)
- **No CDN**: Static assets served from app server
- **No load balancer**: Single instance

### Environment Variables

Required:
- `PORT` — Server port (default: 3000)
- `NODE_ENV` — environment
- `JWT_SECRET` — JWT signing key
- `ENCRYPTION_KEY` — Database field encryption
- `CORS_ORIGIN` — Allowed CORS origin
- `STRIPE_SECRET_KEY` — Stripe API key
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` — Email
- `ADMIN_SEED_SECRET` — Admin creation secret

### Deployment Status

| Component | Local | Production | Notes |
|-----------|-------|------------|-------|
| Health Check | ✅ | ✅ | Working |
| Auth Register | ✅ | ❌ 500 | Needs investigation |
| Auth Login | ✅ | ❌ 500 | Needs investigation |
| Admin Stats | ✅ | ❌ 404 | Route missing? |
| Client List | ✅ | ❌ 404 | Route missing? |
| Stripe Webhooks | ✅ | ? | Needs verification |
| Task API | ✅ | ❌ | Not deployed |

---

## Current Score: SaaS Readiness

| Category | Score | Notes |
|----------|-------|-------|
| Product Identity | 4/10 | Still service-forward |
| Recurring Software Value | 3/10 | Limited self-service features |
| User Accounts | 6/10 | Basic auth works locally |
| Dashboard | 5/10 | Admin + client portals exist |
| Automation | 2/10 | Minimal automated workflows |
| Data Model | 5/10 | Basic schema, needs expansion |
| Analytics | 1/10 | No product analytics |
| Subscription Architecture | 4/10 | Stripe connected, basic |
| Self-Service Onboarding | 3/10 | Manual activation required |
| AI Integration | 2/10 | No AI layer yet |
| Progress Tracking | 4/10 | Basic progress exists |
| Retention Mechanics | 2/10 | No engagement loops |
| B2B Capability | 1/10 | No org/team features |
| Multi-Tenant Architecture | 1/10 | Single tenant |
| Security | 4/10 | Basic helmet, no rate limiting |
| Compliance | 3/10 | Needs review |
| Documentation | 2/10 | Minimal docs |
| API Readiness | 3/10 | Basic REST, no versioning |
| Integration Readiness | 2/10 | Limited external integrations |
| Scalability | 2/10 | SQLite, single instance |
| Reliability | 3/10 | No health checks beyond basic |
| Observability | 1/10 | No monitoring |
| Disaster Recovery | 1/10 | No backups configured |
| Performance | 3/10 | No caching, no optimization |

**Overall SaaS Score: 2.8/10**

Target: 9.5+/10

---

*Document created: 2026-09-03*
*Next update: After Phase 0 completion*
