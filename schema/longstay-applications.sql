-- Long-stay co-applications. Documents are NEVER stored in D1.
-- first_data is temporary personal data and is erased upon completion.
CREATE TABLE IF NOT EXISTS longstay_applications (
  reference TEXT PRIMARY KEY,
  first_email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  second_email TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE,
  first_data TEXT,
  first_signature TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','processing','completed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  invitation_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS longstay_expires ON longstay_applications(expires_at);
CREATE INDEX IF NOT EXISTS longstay_status ON longstay_applications(status);