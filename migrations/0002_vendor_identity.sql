CREATE TABLE IF NOT EXISTS vendor_id_files (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL, slot TEXT NOT NULL,
 document_type TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL,
 size INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded TEXT NOT NULL,
 owner TEXT NOT NULL, UNIQUE(agreement_id,slot)
);
CREATE INDEX IF NOT EXISTS vendor_id_files_agreement ON vendor_id_files(agreement_id);
CREATE TABLE IF NOT EXISTS vendor_id_checks (
 agreement_id TEXT PRIMARY KEY, session_id TEXT, session_url TEXT,
 provider_status TEXT, provider_name TEXT, submitted_name TEXT,
 checked_at TEXT, manual_by TEXT, manual_at TEXT, manual_name TEXT, review_notes TEXT,
 started_at TEXT
);
CREATE TABLE IF NOT EXISTS vendor_id_usage (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL, month TEXT NOT NULL, created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vendor_id_usage_month ON vendor_id_usage(month);
