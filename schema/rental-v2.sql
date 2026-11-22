CREATE TABLE IF NOT EXISTS rental_v2_auth (
 token_hash TEXT PRIMARY KEY,
 role TEXT NOT NULL CHECK(role IN ('owner_login','owner_session')),
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_v2_auth_expiry ON rental_v2_auth(expires_at);
CREATE TABLE IF NOT EXISTS rental_v2_agreements (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('draft','sent','guest_signed','completed','expired')),
 clauses_json TEXT NOT NULL,
 schedule_json TEXT NOT NULL,
 guest_email TEXT NOT NULL,
 guest_token_hash TEXT UNIQUE,
 guest_full_name TEXT,
 guest_dob TEXT,
 guest_phone TEXT,
 identity_session_id TEXT,
 identity_verification_url TEXT,
 identity_status TEXT,
 verified_name TEXT,
 verified_dob TEXT,
 identity_checked_at TEXT,
 guest_signature TEXT,
 guest_signed_at TEXT,
 provider_signature TEXT,
 provider_signed_at TEXT,
 final_pdf BLOB,
 content_sha256 TEXT,
 created_at TEXT NOT NULL,
 sent_at TEXT,
 deadline_at TEXT,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_v2_status ON rental_v2_agreements(status,deadline_at);