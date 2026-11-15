-- Long-stay co-applications. First applicant's PDF is temporarily AES-GCM encrypted in D1 chunks
-- until the second applicant finishes (or the 48-hour invite expires).
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
  invitation_sent_at TEXT,
  first_email_id TEXT,
  first_summary_pages INTEGER
);
CREATE INDEX IF NOT EXISTS longstay_expires ON longstay_applications(expires_at);
CREATE INDEX IF NOT EXISTS longstay_status ON longstay_applications(status);
-- Decision links are emailed only to ProHouse, stored hashed, and expire in 30 days.
-- Approved text data is retained for a limited 90 days for later lease mail merge.
CREATE TABLE IF NOT EXISTS longstay_reviews (
  reference TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  first_email TEXT NOT NULL,
  second_email TEXT,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decision_at TEXT
);
CREATE INDEX IF NOT EXISTS review_status ON longstay_reviews(status);

-- AES-GCM ciphertext only, split below D1's 2 MB BLOB limit. Never accessible through public read APIs.
CREATE TABLE IF NOT EXISTS longstay_application_documents (
  reference TEXT NOT NULL,
  part INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(reference,part)
);
