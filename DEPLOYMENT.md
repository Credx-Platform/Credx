# CredX Deployment Guide

## Pre-Deployment Checklist

### 1. Backup Current Production
- [ ] Export production database from Railway
- [ ] Save current environment variables
- [ ] Note current working endpoints

### 2. Prepare Local Changes
- [ ] All fixes committed to git
- [ ] Database migration script tested
- [ ] Production .env configured

### 3. Deployment Steps

```bash
# Step 1: Login to Railway
railway login

# Step 2: Link to project
railway link

# Step 3: Run deployment script
cd /home/ubuntu/credx-platform
./deploy.sh

# Step 4: Deploy to Railway
railway up

# Step 5: Verify deployment
curl https://credxapi-production.up.railway.app/health
```

### 4. Post-Deployment Verification
- [ ] Health check returns OK
- [ ] Login endpoint works
- [ ] Admin endpoints accessible
- [ ] CORS working from credxme.com
- [ ] Database migrated successfully

### 5. Rollback Plan
If issues occur:
```bash
# Restore from backup
cp /path/to/backup.db ./data/credx.db

# Or revert git changes
git revert HEAD
railway up
```

## Files Modified (Ready to Deploy)

1. `onboarding/server.js` - CORS and middleware fixes
2. `onboarding/db/database.js` - JSON parse error handling
3. `onboarding/routes/auth.js` - Account activation checks
4. `onboarding/public/admin.html` - Dynamic API URL
5. `onboarding/public/portal.html` - Dynamic API URL
6. `onboarding/.env` - Production configuration

## Environment Variables Required

```
PORT=3000
NODE_ENV=production
APP_URL=https://credxme.com
ENCRYPTION_KEY=<32-byte-hex>
JWT_SECRET=<secret>
CORS_ORIGIN=https://credxme.com
ADMIN_SEED_SECRET=<secret>
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=<sendgrid-key>
STRIPE_SECRET_KEY=<stripe-key>
```

## Current Status

| Component | Local | Production | Notes |
|-----------|-------|------------|-------|
| Health Check | ✅ | ✅ | Both working |
| Auth Login | ✅ | ❌ | 500 error on prod |
| Auth Register | ✅ | ❌ | 500 error on prod |
| Admin Stats | ✅ | ❌ | 404 on prod |
| Client List | ✅ | ❌ | 404 on prod |
| CORS | ✅ | ✅ | Configured |

## Next Steps

1. Run the deployment script
2. Verify production endpoints
3. Test admin portal at credxme.com/adminportal
4. Monitor for any issues

## Support

If deployment fails:
1. Check Railway logs: `railway logs`
2. Verify environment variables
3. Check database connectivity
4. Contact support if needed
