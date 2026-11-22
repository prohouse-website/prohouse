# ProHouse Rental Agreement Portal V2

A separate, replacement rental agreement workflow for `prohouse-website/prohouse`, built alongside the existing `/operations/livewithus/` and Vendor Portal without modifying either.

## Implemented

- Private owner sign-in via one-time emailed 15-minute magic link; 7-day owner session.
- Owner can prepare a lease with **all original uploaded clauses selected by default**, untick terms and review a clean guest-facing renumbered version. Source is the user-uploaded `Mutual rental agreement-v10 20261115(1).md`.
- Schedule A with full property address, rented room, restrictions, weekly rent, dates, rent frequency, bonds, utilities, bank details and guest email. Guest cannot change these terms.
- Owner can save a draft, review the PDF, send a unique invitation that expires in 24 hours, and regenerate a fresh link.
- Guest enters legal name, date of birth, phone and consent; Didit identity document, liveness and face-match session is started by one button; approval is checked server-side before signing.
- Guest signs on a signature pad; owner receives an email with verified details and **identity-summary PDF** attachment; owner reviews Didit session privately and countersigns.
- Final PDF preserves the frozen Schedule A and selected terms, both drawn signatures, timestamps and integrity hash; email to both parties.
- Persistent Cloudflare D1 agreement states. No guest access to excluded clauses or an owner-authenticated endpoint.
- Portal is installed at `/operations/rental-v2/`, API at `/api/rental-v2/`.

## Not yet production verified / limitations

1. **This code is an implementation candidate, not a tested production deployment.** It requires the D1 schema, live Resend configuration, Didit credentials/workflow and end-to-end tests with authorised testers.
2. The uploaded original agreement contains legally problematic eviction, lock-out, late-fee and bond clauses. **Sending is disabled unless `RENTAL_V2_SENDING_ENABLED` is explicitly set to `true` after Australian legal review for the property type and jurisdiction**. Code defaults to off.
3. The owner notification currently attaches a **Didit verification summary PDF**, not an actual photograph of a government identity document or Didit's full PDF session report. That full report is available through the authenticated Didit Business Console. Automated retrieval and secure export have not been validated against Didit's report APIs. Do not call the summary an ID scan.
4. This initial PDF renderer uses PDF standard fonts and replaces characters it cannot encode. Before signing with accented legal names or non-Latin scripts, replace it with an embedded Unicode-capable PDF font and regression-test Unicode names. Never send a final PDF with a mismatched legal name.
5. Single-guest workflow is implemented. Multiple signers need individual invitation tokens and independently verified signature slots.
6. Production-hardening before launch should include transactional email outbox handling, signed webhook reconciliation, abuse/identity attempt monitoring, full accessibility QA, retention policy and a privacy notice.

## Apply to existing ProHouse repository

Copy these files to the same relative paths in the existing repository:

- `src/rental-v2.js`
- `src/rental-v2-clauses.js`
- `public/operations/rental-v2/index.html`
- `schema/rental-v2.sql`

In `src/worker.js` add the import:

```js
import { rentalV2 } from './rental-v2.js';
```

Add routing **before** the catch-all `/api/` not-found handler:

```js
if (path.startsWith('/api/rental-v2/')) return rentalV2(request, env);
```

`package.json` already contains `pdf-lib@1.17.1` and `wrangler.jsonc` already binds `LONGSTAY_DB`, so do not add another database or package.

## Database setup

Apply `schema/rental-v2.sql` to the correct private D1 database on preview then production. Example for the configured D1 binding:

```sh
npx wrangler d1 execute prohouse-longstay-applications-preview --remote --file=schema/rental-v2.sql
npx wrangler d1 execute prohouse-longstay-applications --remote --file=schema/rental-v2.sql
```

Inspect and confirm the database names, environment and access before running commands. The schema adds tables; it does not alter legacy applications or leases.

## Secrets and variables

- `RESEND_API_KEY`: existing email service; required for one-time login and guest invitations.
- `DIDIT_API_KEY`: Cloudflare secret; required for guest ID verification.
- `DIDIT_WORKFLOW_ID`: published Didit ID, selfie/liveness and face-match workflow; the key and workflow must belong to the **same** Didit application/environment.
- `PROHOUSE_ADMIN_EMAILS`: existing authorised email list; defaults in the UI to `hi@prohouse.com.au`, but the API checks the environment allowlist.
- `RENTAL_V2_SENDING_ENABLED`: omit or set `false` until the template is legally approved. Only set `true` when production has passed all checks.

Never place Didit/Resend API keys in JavaScript, GitHub or the browser.

## Suggested prelaunch checks

1. Validate D1 migration on preview. Request owner sign-in and verify only allowlisted email receives the link.
2. Select all clauses, untick a few, save a draft and inspect preview/PDF; unticked terms must not be visible.
3. Check weekly rent is immutable for guest, and 24-hour expiry is enforced using the server clock.
4. Validate real Didit workflow with approved, declined, in-review and mismatching-name tests; confirm ID checks run as configured.
5. Verify guest signature, owner notification, owner authentication, countersignature and both final PDF email attachments.
6. Check audit hash, user names with Vietnamese accents, mobile browsers, email bounce/retry behaviour and shared tablet sign-in.
7. Obtain legal approval for NSW/VIC use and classify each property's tenancy/occupancy status correctly before enabling sending.