CREATE TABLE IF NOT EXISTS longstay_identity_sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('first','second')),
  invite_reference TEXT,
  legal_name TEXT NOT NULL,
  email TEXT NOT NULL,
  vendor_data TEXT NOT NULL UNIQUE,
  session_id TEXT UNIQUE,
  session_url TEXT,
  provider_status TEXT NOT NULL,
  provider_name TEXT,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  checked_at TEXT,
  verified_at TEXT,
  used_reference TEXT
);
CREATE INDEX IF NOT EXISTS longstay_identity_by_invite ON longstay_identity_sessions(invite_reference);
CREATE INDEX IF NOT EXISTS longstay_identity_expiry ON longstay_identity_sessions(expires_at);