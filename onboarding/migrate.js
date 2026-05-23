#!/bin/bash
# Database migration script for CredX

set -e

echo "=== CredX Database Migration ==="

DB_PATH=${DB_PATH:-"./data/credx.db"}

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "❌ Database not found at $DB_PATH"
    exit 1
fi

echo "Database found at: $DB_PATH"

# Backup current database
BACKUP_PATH="${DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$DB_PATH" "$BACKUP_PATH"
echo "✅ Database backed up to: $BACKUP_PATH"

# Run migration
echo ""
echo "Running migrations..."
node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || './data/credx.db');

// Check current schema
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log('Existing tables:', tables.map(t => t.name).join(', '));

// Add invite columns if missing
const userCols = db.pragma('table_info(users)').map(c => c.name);
if (!userCols.includes('invite_token')) {
    console.log('Adding invite columns...');
    db.exec('ALTER TABLE users ADD COLUMN invite_token TEXT');
    db.exec('ALTER TABLE users ADD COLUMN invite_expires TEXT');
    db.exec('ALTER TABLE users ADD COLUMN invite_used INTEGER DEFAULT 0');
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 1');
}

// Add MFSN columns if missing
if (!userCols.includes('mfsn_member_id')) {
    console.log('Adding MFSN columns...');
    db.exec('ALTER TABLE users ADD COLUMN mfsn_member_id TEXT');
    db.exec('ALTER TABLE users ADD COLUMN mfsn_api_token TEXT');
    db.exec('ALTER TABLE users ADD COLUMN mfsn_connected_at TEXT');
    db.exec('ALTER TABLE users ADD COLUMN mfsn_last_synced_at TEXT');
}

// Check for user_analysis table
const hasAnalysis = tables.some(t => t.name === 'user_analysis');
if (!hasAnalysis) {
    console.log('Creating user_analysis table...');
    db.exec(\`
        CREATE TABLE IF NOT EXISTS user_analysis (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            analysis TEXT,
            dispute_strategy TEXT,
            workflow TEXT,
            updated_at TEXT NOT NULL
        )
    \`);
}

// Check for payments table
const hasPayments = tables.some(t => t.name === 'payments');
if (!hasPayments) {
    console.log('Creating payments table...');
    db.exec(\`
        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            stripe_session_id TEXT,
            status TEXT DEFAULT 'none',
            plan TEXT,
            amount_cents INTEGER,
            current_period_end TEXT,
            cancel_at_period_end INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    \`);
}

console.log('✅ Migration complete');
"

echo ""
echo "=== Migration Complete ==="
echo "Database is ready for deployment"
