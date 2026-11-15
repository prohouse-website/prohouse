CREATE TABLE IF NOT EXISTS longstay_lease_packets (
 reference TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'draft'
  CHECK(status IN ('draft','sent','tenants_signed','expired','provider_signing','completed')),
 application_json TEXT NOT NULL,
 settings_json TEXT NOT NULL,
 draft_pdf BLOB NOT NULL,
 lease_pdf BLOB,
 final_pdf BLOB,
 first_token_hash TEXT UNIQUE,
 second_token_hash TEXT UNIQUE,
 sent_at TEXT,
 deadline_at TEXT,
 first_signed_at TEXT,
 second_signed_at TEXT,
 first_signature TEXT,
 second_signature TEXT,
 payment_reported_at TEXT,
 payment_reference TEXT,
 payment_verified_at TEXT,
 payment_verified_by TEXT,
 provider_signature TEXT,
 provider_signed_at TEXT,
 completed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lease_packets_due ON longstay_lease_packets(status,deadline_at);