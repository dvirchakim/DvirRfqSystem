-- ── RFQ data (written by app, queried by agent) ──────────────────
CREATE TABLE IF NOT EXISTS rfqs (
  id                   TEXT PRIMARY KEY,
  customer_name        TEXT,
  part_number          TEXT,
  quantity             INTEGER,
  delivery_date        TEXT,
  accepts_alternatives TEXT,
  target_price         NUMERIC,
  status               TEXT DEFAULT 'new',
  priority             TEXT DEFAULT 'medium',
  is_obsolete          BOOLEAN DEFAULT FALSE,
  special_requirements TEXT,
  summary              TEXT,
  sender               TEXT,
  from_email           TEXT,
  human_loop           BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);

-- ── User UI preferences ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_id     VARCHAR(100) PRIMARY KEY,
  theme       VARCHAR(50)  DEFAULT 'dark',
  layout_json JSONB        NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMP    DEFAULT NOW()
);

-- ── Read-only role for the agent ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rfq_readonly') THEN
    CREATE ROLE rfq_readonly NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO rfq_readonly;
GRANT SELECT ON rfqs                TO rfq_readonly;
GRANT SELECT ON user_ui_preferences TO rfq_readonly;

-- ── Agent database user (SELECT-only) ────────────────────────────
-- No password is set here on purpose — the user cannot authenticate until
-- init-agent-password.sh (run right after this script, see docker-compose.yml)
-- sets it from the AGENT_DB_PASSWORD env var. Never hardcode a real password here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rfq_agent') THEN
    CREATE USER rfq_agent;
  END IF;
END
$$;

GRANT rfq_readonly TO rfq_agent;
GRANT CONNECT ON DATABASE rfq_db TO rfq_agent;
