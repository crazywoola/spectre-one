CREATE TABLE IF NOT EXISTS incident_reports (
  id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT,
  user_name TEXT NOT NULL,
  deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'self-hosted')),
  cloud_plan TEXT CHECK (cloud_plan IN ('TEAM', 'PRO', 'FREE') OR cloud_plan IS NULL),
  account_email TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT NOT NULL,
  description_word_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  response_model TEXT,
  response_text TEXT,
  response_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incident_reports_created_at
  ON incident_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_reports_status
  ON incident_reports (status);

CREATE INDEX IF NOT EXISTS idx_incident_reports_email
  ON incident_reports (account_email);
