import psycopg2
import os
import json


class PostgresClient:
    def __init__(self):
        self.conn = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=os.getenv("POSTGRES_PORT", "5432"),
            database=os.getenv("POSTGRES_DB", "credx_platform"),
            user=os.getenv("POSTGRES_USER", "credx"),
            password=os.getenv("POSTGRES_PASSWORD", "credx_secure_2024"),
        )

    def create_investigation(self, **kwargs):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO investigations
                    (id, subject_name, subject_aliases, known_city, known_state,
                     known_email, known_phone, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
                """,
                (
                    kwargs["id"],
                    kwargs["subject_name"],
                    kwargs.get("subject_aliases") or [],
                    kwargs.get("known_city"),
                    kwargs.get("known_state"),
                    kwargs.get("known_email"),
                    kwargs.get("known_phone"),
                    kwargs.get("status", "active"),
                ),
            )
            self.conn.commit()

    def update_investigation(self, investigation_id: str, **kwargs):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                UPDATE investigations
                SET status = %s, updated_at = NOW(),
                    confidence_score = %s, final_report = %s
                WHERE id = %s
                """,
                (
                    kwargs.get("status", "completed"),
                    kwargs.get("confidence_score"),
                    json.dumps(kwargs.get("final_report")) if kwargs.get("final_report") else None,
                    investigation_id,
                ),
            )
            self.conn.commit()

    def log_audit(self, **kwargs):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO audit_logs
                    (agent_name, action, investigation_id, subject_id,
                     results_count, confidence_score, data_sources)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    kwargs["agent_name"],
                    kwargs["action"],
                    kwargs.get("investigation_id"),
                    kwargs.get("subject_id"),
                    kwargs.get("results_count", 0),
                    kwargs.get("confidence_score", 0),
                    json.dumps(kwargs.get("data_sources", [])),
                ),
            )
            self.conn.commit()
