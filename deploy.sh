#!/bin/bash
# Safe deployment script for CredX to Railway

set -e

echo "=== CredX Safe Deployment to Railway ==="
echo ""

# Step 1: Create backup
echo "[1/5] Creating backup..."
BACKUP_DIR="/home/ubuntu/credx-deploy-backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r /home/ubuntu/credx-platform/onboarding "$BACKUP_DIR/"
echo "✅ Local backup created at $BACKUP_DIR"

# Step 2: Prepare production .env
echo ""
echo "[2/5] Preparing production environment..."
cat > /home/ubuntu/credx-platform/onboarding/.env.production << EOF
PORT=3000
NODE_ENV=production

# Business info
BUSINESS_NAME=The Malloy Group Financial LLC
SUPPORT_EMAIL=contact@credxme.com
APP_URL=https://credxme.com

# Encryption key - MUST match production or data will be unreadable
ENCRYPTION_KEY=\${ENCRYPTION_KEY:?Set ENCRYPTION_KEY before running deploy.sh}

# SMTP — SendGrid
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=\${SENDGRID_API_KEY:?Set SENDGRID_API_KEY before running deploy.sh}
EMAIL_FROM=CredX <hello@credxme.com>

# Database path
DB_PATH=/app/data/credx.db

# JWT auth secret
JWT_SECRET=\${JWT_SECRET:?Set JWT_SECRET before running deploy.sh}
JWT_EXPIRES=30d

# CORS - Restricted to production domain
CORS_ORIGIN=https://credxme.com
ADMIN_SEED_SECRET=\${ADMIN_SEED_SECRET:?Set ADMIN_SEED_SECRET before running deploy.sh}

# Stripe
STRIPE_SECRET_KEY=sk_test_REPLACE_WITH_YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_WITH_YOUR_WEBHOOK_SIGNING_SECRET
STRIPE_PRICE_MONTHLY=price_REPLACE_WITH_MONTHLY_PRICE_ID
STRIPE_PRICE_SETUP=price_REPLACE_WITH_SETUP_FEE_PRICE_ID
EOF
echo "✅ Production .env prepared"

# Step 3: Commit changes
echo ""
echo "[3/5] Committing changes..."
cd /home/ubuntu/credx-platform
git add -A
git commit -m "Fix: Admin portal, auth endpoints, CORS, and database error handling

- Fixed JSON parse errors in database layer
- Added proper CORS for production
- Fixed account activation status checks
- Updated admin/portal HTML for dynamic API URLs
- Added error handling for corrupted data" || echo "Nothing to commit"
echo "✅ Changes committed"

# Step 4: Deploy to Railway
echo ""
echo "[4/5] Deploying to Railway..."
echo "⚠️  This requires Railway CLI authentication"
echo ""
echo "Please run: railway login"
echo "Then: railway link"
echo "Then: railway up"
echo ""

# Step 5: Verify
echo ""
echo "[5/5] Verification checklist:"
echo "  ☐ Check https://credxapi-production.up.railway.app/health"
echo "  ☐ Test login: POST /api/auth/login"
echo "  ☐ Test admin: GET /api/admin/stats"
echo "  ☐ Check https://credxme.com/adminportal"
echo ""

echo "=== Deployment Preparation Complete ==="
echo "Backup location: $BACKUP_DIR"
