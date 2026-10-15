CREATE TABLE IF NOT EXISTS cleaner_login (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, ip_hash TEXT NOT NULL,
 created INTEGER NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cleaner_login_email ON cleaner_login(email, created);
CREATE INDEX IF NOT EXISTS cleaner_login_ip ON cleaner_login(ip_hash, created);
CREATE TABLE IF NOT EXISTS cleaner_sessions (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cleaner_agreements (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, status TEXT NOT NULL,
 data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cleaner_agreements_email ON cleaner_agreements(email);
CREATE TABLE IF NOT EXISTS cleaner_mail (
 id TEXT PRIMARY KEY, agreement_id TEXT, kind TEXT NOT NULL, recipient TEXT NOT NULL,
 payload TEXT NOT NULL, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
