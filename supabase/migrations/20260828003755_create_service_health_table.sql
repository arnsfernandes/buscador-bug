CREATE TABLE IF NOT EXISTS service_health (
  service_name TEXT PRIMARY KEY,
  consecutive_failures INTEGER DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  alert_sent BOOLEAN DEFAULT FALSE,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
