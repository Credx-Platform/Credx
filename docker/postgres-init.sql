CREATE TABLE IF NOT EXISTS investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active',
    subject_name VARCHAR(255) NOT NULL,
    subject_aliases TEXT[],
    known_city VARCHAR(100),
    known_state VARCHAR(50),
    known_email VARCHAR(255),
    known_phone VARCHAR(20),
    confidence_score DECIMAL(5,3),
    final_report JSONB
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    agent_name VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    investigation_id UUID,
    subject_id VARCHAR(255),
    results_count INTEGER,
    confidence_score DECIMAL(3,2),
    data_sources JSONB
);
