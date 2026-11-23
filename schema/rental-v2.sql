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
-- Admin password login (PBKDF2 hashes, never plaintext passwords).
CREATE TABLE IF NOT EXISTS rental_v2_owner_credentials (
 email TEXT PRIMARY KEY,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 iterations INTEGER NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rental_v2_password_tokens (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('setup','reset')),
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_v2_password_tokens_email ON rental_v2_password_tokens(email);
CREATE TABLE IF NOT EXISTS rental_v2_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 agreement_id TEXT NOT NULL,
 previous_guest_email TEXT NOT NULL,
 previous_guest_name TEXT,
 previous_schedule_json TEXT NOT NULL,
 previous_clauses_json TEXT NOT NULL,
 changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_v2_revisions_agreement ON rental_v2_revisions(agreement_id);
