-- Dedicated Share Bill usage analytics database.
-- Stores event labels + timestamps only (never invoice, guest or device data).
CREATE TABLE IF NOT EXISTS sharebill_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_day TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('visit','calculation','scan','pdf_download'))
);
CREATE INDEX IF NOT EXISTS idx_sharebill_usage_day
  ON sharebill_usage(event_day,event_type);

-- Atomic report deduplication, so scheduled jobs do not email a day twice.
CREATE TABLE IF NOT EXISTS sharebill_email_reports (
  event_day TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
