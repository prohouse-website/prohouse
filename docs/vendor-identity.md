# Vendor agreement portal

Preview: https://new-vendor-agreement-portal-prohouse.hi-07f.workers.dev/vendors/

New agreements use version `2026-10-15.4`. Stored signed snapshots retain their original terms. Use a replacement agreement for revised terms; never rewrite an existing signed submission.

## Agreement flow

ProHouse and vendors sign in with email codes. ProHouse sets scope, contacts, service address, fixed payment terms and optional offered rates. Vendors enter business/bank details and final requested rates, complete Didit identity verification, then sign. ProHouse reviews the verified signatory name and final rates before countersigning. Both parties receive a complete PDF attachment, including both signatures/timestamps, final rates, all stored terms and audit hashes. The authenticated Download PDF link generates the same contract snapshot. Pending email delivery is retained in the outbox for ProHouse retry.

## Terms and operations

- Editable defaults: ProHouse; ABN 36 608 845 532; 15 Guess Avenue, Wolli Creek; phone 0423 696 436; email hi@prohouse.com.au; service address G01/52-62 Arncliffe Street, Wolli Creek NSW 2205.
- The terms refer to the contacts in the schedule instead of repeating a phone number.
- Doors and windows remain locked; no tailgating or voluntary admission based on a claimed role. Refer access requests to ProHouse at the listed contacts. The terms preserve lawful entry and emergency access.
- Urgent matters: call first, then send WhatsApp photo evidence. All damage and extra-charge reports must reach WhatsApp before 9 pm Sydney time on departure day. Obtain written approval before extras, subject to immediate emergency loss prevention.
- Either party gives at least 30 calendar days’ advance written notice of proposed rate increases or termination; rate increases require both parties’ express written acceptance. Serious-breach/mandatory-rights protections remain.
- ProHouse controls payment terms. Vendor paymentDays/paymentTerms/proposal overrides are rejected.
- After each clean, vendors must upload after-cleaning photos to the portal or send them via WhatsApp, identifying service date and room/areas and avoiding personal information.

## Identity: Didit only

Manual ID upload and review endpoints now return 410. No separate identity checkbox appears in the portal. Selecting Verify with Didit opens the hosted verification process, where the vendor reviews privacy information and gives any required provider consent. Existing private scans remain restricted by authentication; they are not migrated or deleted by this change. ProHouse retains a backend deletion route for existing scans. Completed historical identity snapshots remain unchanged.

Runtime settings: `DIDIT_API_KEY` secret, `DIDIT_WORKFLOW_ID` variable, `DIDIT_MONTHLY_LIMIT` variable. Preview settings are configured; production activation remains part of release. Preview source includes the workflow reference and a 25-start monthly cap; the secret is never in source. The cap is local to this portal and is not a provider-wide billing or free-tier guarantee. Other use of the Didit account also consumes its allowance; pricing changes noted in the account apply. The integration never enables a paid plan or tops up credits.

Sessions are created server-side. Decision retrieval requires matching session, agreement reference and workflow, Approved overall status, successful ID/liveness/face-match checks and a matching signatory name before acceptance. Browser callback parameters cannot approve verification. Provider results are mocked in automated tests; a real full Didit verification is still an acceptance check.

## After-cleaning evidence

Apply `migrations/0003_service_evidence.sql` before deployment. Evidence is stored as private D1 BLOBs separate from signed contract data. Only the agreement’s invited vendor can upload, after both signatures. ProHouse and that vendor can view; other vendors and unauthenticated visitors cannot. JPEG, PNG and WebP only, magic-byte checked, max 1 MB each and 20 photos per service date. The portal lists the latest 200 photos; WhatsApp is an alternative for larger photos. Service photos are not PDF attachments and do not modify signed hashes. No public image bucket is used.

## Validation

Run `node --test test/cleaner-portal.test.js` (Node SQLite and Poppler `pdftotext` required). Tests cover signing/immutability, queued PDF emails/retries, PDF content, private evidence access, Didit-only gating and authenticated provider decisions. Worker packaging uses the existing Wrangler configuration. PDF rendering is inspected with Poppler before release.

## Portal address and sender

The portal is served at `/vendors/`, with `/cleaners/` redirected for existing invitations. New UI API calls use `/api/vendors/`; legacy `/api/cleaners/` remains a compatible alias. Static source remains in `public/cleaners` and is internally served under `/vendors`. Both preview hostnames share the same isolated database. `VENDOR_PORTAL_ORIGIN` makes the new preview the canonical portal host; it is omitted from production settings. Agreement and survey sender settings now use `no-reply@prohouse.com.au`; replies continue to go to `hi@prohouse.com.au`. Preview CI deploys both hostnames to preserve old links.

Production links and `/vendors/` redirect to the established vendor-portal host so existing real agreements remain accessible in its database. Guest website pages stay on the production domain.
