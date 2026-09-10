# CredX Infrastructure Map

## Current Infrastructure

### Hosting
- **Primary**: Railway (Docker deployment)
- **Domain**: credxme.com
- **API Endpoint**: api.credxme.com (or Railway-provided domain)
- **Status**: Single instance, no load balancing

### Services

```
Browser
  ↓
Cloudflare (DNS) — inferred from email protection
  ↓
Railway Load Balancer
  ↓
CredX Docker Container
  ├── Express Web Server (Node.js)
  ├── Static Files (public/)
  └── SQLite Database (single file)
```

### Database
- **Type**: SQLite (better-sqlite3)
- **Location**: Local file within container
- **Persistence**: Railway volume (assumed)
- **Backup Strategy**: NONE DOCUMENTED ⚠️
- **Connection Pooling**: NONE ⚠️
- **Migration System**: Manual (migrate.js exists)

### External Services

| Service | Status | Purpose | Failure Impact |
|---------|--------|---------|----------------|
| Stripe | ✅ Active | Payments, subscriptions | Billing fails |
| SendGrid (SMTP) | ✅ Configured | Transactional emails | Email fails |
| Railway | ✅ Active | Hosting, deployment | Full outage |
| SQLite | ✅ Active | Primary database | Full outage |

### Missing Infrastructure

| Component | Status | Risk Level |
|-----------|--------|------------|
| PostgreSQL | ❌ Not configured | HIGH — SQLite not suitable for SaaS |
| Redis | ❌ Not installed | MEDIUM — No caching/queueing |
| PgBouncer | ❌ Not installed | MEDIUM — When PG added |
| CDN | ❌ Not configured | LOW — Static assets served from app |
| S3/R2 Storage | ❌ Not configured | HIGH — Documents not securely stored |
| Sentry | ❌ Not configured | HIGH — No error tracking |
| PostHog | ❌ Not configured | MEDIUM — No product analytics |
| Load Balancer | ❌ Not needed yet | LOW — Single instance |
| Worker Service | ❌ Not configured | MEDIUM — Background jobs run inline |

### Railway Configuration

```toml
# railway.toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node server.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### Docker Configuration

```dockerfile
# Dockerfile (simplified)
FROM node:20-alpine
WORKDIR /app
COPY onboarding/package*.json ./
RUN npm ci --only=production
COPY onboarding/ ./
EXPOSE 3000
CMD ["node", "server.js"]
```

### Environment Variables

```bash
# Required
PORT=3000
NODE_ENV=production
APP_URL=https://credxme.com
JWT_SECRET=<secret>
ENCRYPTION_KEY=<secret>
CORS_ORIGIN=https://credxme.com
ADMIN_SEED_SECRET=<secret>

# Email
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=<sendgrid-key>

# Payments
STRIPE_SECRET_KEY=<stripe-key>
STRIPE_WEBHOOK_SECRET=<webhook-secret>
STRIPE_PRICE_ID=<price-id>
```

### Resource Allocation

| Resource | Current | Recommended |
|----------|---------|-------------|
| CPU | Unknown | 1+ vCPU |
| RAM | Unknown | 512MB+ |
| Disk | SQLite file | 10GB+ for PG + storage |
| Network | Shared | Dedicated if high traffic |

### Deployment Process

1. Local changes committed to git
2. `railway up` deploys
3. Health check validates `/health`
4. Container restarted if unhealthy

### Rollback Process

1. `git revert HEAD` or checkout previous commit
2. `railway up`
3. Manual database restore if needed

### Backup Status

⚠️ **CRITICAL**: No automated backups documented

Manual backup process (from DEPLOYMENT.md):
```bash
# Export production database
# Save environment variables
# Note working endpoints
```

---

## Infrastructure Gaps

1. **Database**: SQLite → PostgreSQL migration needed
2. **Caching**: Redis needed for sessions/cache
3. **Queueing**: Redis/BullMQ needed for background jobs
4. **Storage**: Secure object storage for documents
5. **Monitoring**: Sentry or equivalent for error tracking
6. **Analytics**: PostHog or equivalent for product analytics
7. **CDN**: Cloudflare or equivalent for static assets
8. **Backups**: Automated database backups
9. **Workers**: Separate worker process for background jobs
10. **Staging Environment**: Not documented

---

*Document created: 2026-09-03*
