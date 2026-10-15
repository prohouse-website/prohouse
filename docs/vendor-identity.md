# Vendor terms and identity review

The portal remains at `/cleaners/` so existing invitation links continue working. All new UI labels, agreements, invitations and notifications use **vendor**. Existing signed snapshots retain their original terms and vocabulary. New agreements use terms version `2026-10-15.2`.

## Defaults and terms

- Contracting name: ProHouse (editable by ProHouse before sending).
- ABN: 36 608 845 532.
- Business address: 15 Guess Avenue, Wolli Creek.
- Separate service address: G01/52-62 Arncliffe Street, Wolli Creek NSW 2205 (editable).
- Contact phone: 0423 696 436. Contact email and invoice destination: hi@prohouse.com.au.
- Either party gives 28 days’ written notice to end future engagements; existing serious-breach and mandatory-rights protections remain.
- Operational/urgent calls go to 0423 696 436. Every damage report and extra-charge request must also go through WhatsApp at the same number, with evidence and the requested amount. The before-9pm checkout-report deadline remains.
- ProHouse sets payment days. The vendor only proposes rates and service inclusions; a submitted paymentDays/paymentTerms/proposal override is rejected. Pricing notes cannot vary payment obligations.

## Private ID upload and manual review — active without a paid service

1. The invited, email-authenticated vendor opens the individual agreement and uploads a current photo ID after consenting to private storage/review.
2. Passport photo page: front only. Driver licence/national ID: matching document type, front and back. JPEG, PNG or WebP, up to 1 MB per image.
3. The vendor may sign after upload. The documents then lock against replacement.
4. ProHouse opens the private images, checks photo/name/expiry and the authorised signatory, records the full ID holder name and confirms manual review. The reviewed name must match the vendor signatory for countersignature.
5. Countersigning captures the method, reviewer, timestamp and document hashes in the completed agreement audit record. Raw ID images are never attached to the emailed contract.

Uploads are stored as private D1 BLOB records on the existing database. R2 is not enabled for the account, so no public bucket or new R2 billing setup is required. File delivery is authenticated and restricted to ProHouse or that record’s invited vendor; responses disable caching, sniffing and script execution. Magic-byte checks restrict uploads to supported image types. An upload is explicitly not proof of authenticity.

ProHouse can delete uploaded scans when no longer needed through **Delete stored ID photos**. This clears any pending manual review; completed contract audit snapshots are preserved. No automatic deletion or indefinite retention period is promised. ProHouse remains responsible for a lawful retention policy and restricted access.

Apply `migrations/0002_vendor_identity.sql` to the production and isolated preview D1 databases before deployment. This migration was applied through the Cloudflare connector during this change.

## Optional free-tier Didit integration — credentials required

Official pricing checked 15 October 2026 lists 500 free full KYC verifications per month. Pricing/plan eligibility can change; confirm in the ProHouse Didit account before activation:

- https://didit.me/pricing/
- https://docs.didit.me/sessions-api/create-session
- https://docs.didit.me/sessions-api/retrieve-session

Activation requires a ProHouse account at https://business.didit.me and a workflow containing **ID Verification, Passive Liveness and Face Match**. Add these runtime settings directly in Cloudflare for production and the selected preview:

| Setting | Type | Meaning |
| --- | --- | --- |
| `DIDIT_API_KEY` | Secret | Key from the ProHouse Didit account; never put in source/chat |
| `DIDIT_WORKFLOW_ID` | Variable | ID of the configured ID + liveness + face-match workflow |
| `DIDIT_MONTHLY_LIMIT` | Variable, optional | Portal-side session cap, default 450, maximum 450; zero disables new sessions |

Without both key and workflow, the portal clearly shows that automatic verification is not activated. It retains the working free manual-upload path. No Didit account has been created, no live identity documents have been sent to Didit, and no real automatic check has been executed during development.

The vendor explicitly consents before leaving the portal for Didit’s hosted document/selfie/liveness flow. On return, the portal requests the saved session’s decision directly from Didit’s server. It does not trust a browser callback, query-string status or client-submitted “verified” flag. Session ID, vendor reference and workflow must match. Approval requires top-level Approved and successful ID, liveness and face-match results; the document name must match the vendor signatory before ProHouse countersigns. Only the result/name/session reference are retained, not the full biometric payload.

A transactional local usage reservation caps this portal at 450 session attempts/month, with two attempts per agreement. Existing session links are reused. This is not a provider-wide billing cap: checks started elsewhere in the same Didit account also use the free allowance. Use the provider’s free plan/no paid credits and confirm no paid modules are enabled. The app does not top up credits or enable paid plans.

## Verification

Automated tests use synthetic local ID-image bytes and mocked provider responses. They verify authorisation, private file delivery, identity gating, manual-review name matching, payment-term tampering rejection, provider reference checks, required provider checks, final audit snapshots and the existing agreement lifecycle. They do not validate a real person’s identity. Browser/mobile upload and a live Didit flow still require an acceptance check.
