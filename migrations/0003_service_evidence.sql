CREATE TABLE IF NOT EXISTS vendor_service_photos (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES cleaner_agreements(id),
 service_date TEXT NOT NULL, caption TEXT NOT NULL, mime TEXT NOT NULL,
 bytes BLOB NOT NULL, size INTEGER NOT NULL, uploaded TEXT NOT NULL, owner TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vendor_service_photos_agreement ON vendor_service_photos(agreement_id, service_date);
