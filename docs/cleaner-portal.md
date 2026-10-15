# ProHouse cleaner agreements

Target production URL: https://www.prohouse.com.au/cleaners/

This portal is part of the existing ProHouse Cloudflare Worker and GitHub repository. It does not redirect to the earlier ChatGPT-hosted application. Existing guest website design, booking and survey routes are preserved. The portal is excluded from search indexing.

## Included workflow

1. ProHouse chooses **ProHouse sign-in** and verifies the code emailed to an authorised address. The default authorised address is `hi@prohouse.com.au`. Additional authorised addresses must be configured by the operator, never selected by visitors.
2. ProHouse enters the cleaner email, its own contracting legal entity, ABN and address, start date, payment period, services and pricing columns (description, unit, AUD rate), GST and insurance. The full terms are shown before **Send agreement by email**.
3. The invited cleaner receives a link on the ProHouse domain, chooses **Cleaner sign-in**, and verifies the code sent to that same email. No ChatGPT account is needed. Cleaner accounts can only read and sign their own agreements.
4. The cleaner enters legal name, entity, valid ABN, phone, business address, bank name, account name, BSB and account number. The verified email is fixed. The cleaner can propose different per-service prices, GST and pricing notes, reads all terms, then types their full legal name and accepts electronic signing.
5. The cleaner submission is locked and ProHouse receives a notification at `hi@prohouse.com.au` to review the exact final rates and countersign.
6. ProHouse countersigns. Both parties are emailed the complete signed HTML document as an attachment, including all terms, scope, final rates, both signatures, timestamps, activity and integrity hashes. A copy remains accessible through authenticated download. Open the downloaded HTML in a browser to print/save as PDF. Automated PDF attachment generation is not included.

The cleaning window remains 10am to strictly before 3pm. Checkout concerns require reports before 9pm Sydney time. Maintenance reporting and weekly invoices after Sunday to hi@prohouse.com.au are retained. No terms or pricing can be edited after cleaner signature; withdraw an incomplete agreement and send a replacement instead. Completed agreements cannot be withdrawn through the portal.

## Activation status

Source is implemented and tested. Production and isolated preview D1 databases have been created through the connected Cloudflare account and the migration has been applied to both. The existing production Worker has a RESEND_API_KEY runtime secret. Live inbox delivery and a browser-based signing run remain unverified.

The branch now contains the real production and preview database bindings in `wrangler.jsonc`. These take effect in the corresponding deployment; production code still follows the preview → Brian approval → merge workflow.

## Cloudflare setup (once)

Use the existing `prohouse` Worker; do not create a second website or change DNS. From this branch on an authenticated computer:

```sh
npx wrangler login
npx wrangler d1 create prohouse-cleaner-agreements
npx wrangler d1 create prohouse-cleaner-agreements-preview
```

Copy the two actual `database_id` values from those commands, then run:

```sh
node scripts/configure-cleaner-db.mjs PRODUCTION_DATABASE_ID PREVIEW_DATABASE_ID
```

The script writes the production binding and a separate `previews.d1_databases` override. Check your installed Wrangler version accepts the preview override (`npx wrangler preview --help`). Configure an isolated preview binding using the current Cloudflare preview settings if required by your Workers Builds version. Never point a public preview at production agreements.

Apply the migration to each database:

```sh
npx wrangler d1 execute prohouse-cleaner-agreements --remote --file=migrations/0001_cleaner_portal.sql
npx wrangler d1 execute prohouse-cleaner-agreements-preview --remote --file=migrations/0001_cleaner_portal.sql
```

Ensure these **runtime** settings exist in both production and preview:

| Name | Type | Value |
| --- | --- | --- |
| `CLEANER_DB` | D1 binding | The selected production or isolated preview database |
| `RESEND_API_KEY` | Secret | Existing Resend sending key, if valid for the verified ProHouse sender/domain |
| `CLEANER_FROM_EMAIL` | Variable | `ProHouse Agreements <reviews@prohouse.com.au>` (or another verified ProHouse sender) |
| `PROHOUSE_ADMIN_EMAILS` | Variable | `hi@prohouse.com.au` (comma-separated operator-approved addresses if needed) |

The portal reuses the existing `RESEND_API_KEY` and falls back to `SURVEY_FROM_EMAIL` when no dedicated sender is set. Do not overwrite the survey sender or put secrets in Git. Commit the reviewed database configuration on this branch, push, obtain the Cloudflare preview, complete the acceptance check, and request Brian's approval before merging to main under the established publishing workflow.

## Acceptance check before production

Use two controlled inboxes: one operator address and one test cleaner address. Sending a real agreement invitation is an intentional email action. Verify code delivery, different sign-in roles, creation, invitation, cleaner business details, counter-proposed rates, cleaner signature, ProHouse notification, countersignature and two received attachments. Open both attachments and verify the exact scope, full terms and signatures. Test on mobile. Confirm an unrelated cleaner cannot view the record or downloaded copy. A Resend API success means provider acceptance, not proof of inbox delivery; inspect provider delivery/bounce logs as needed.

## Delivery and records

Agreement transitions and email outbox entries are stored atomically in D1. The app attempts sends immediately after each transition. ProHouse sees provider acceptance or pending delivery per email and can click **Retry pending emails**. Retries reuse an idempotency key; the Resend idempotency window is finite, so investigate ambiguous long-delayed delivery before retrying. There is no background mail scheduler or delivery webhook here. A failed email never rolls back a saved signature. Cleaners see a pending notification notice when delivery fails.

Sessions use secure HttpOnly cookies, last eight hours, and are revoked on sign-out. Email codes last ten minutes, allow at most eight verification attempts, and can only be used once. Requests are limited by email and IP; the configured Cloudflare sender and sending limits must support OTP mail. IDs in invitation links are references, not access tokens. Sensitive records are only returned after email authentication and server-side authorisation. Treat retained bank details and email attachments as confidential. ABNs pass the checksum check; a checksum does not verify ownership or current registration.

The previous ChatGPT-hosted app and its records are not automatically migrated. Preserve any existing executed records separately; invite cleaners for new agreements through this portal after activation.

## Development checks

```sh
node --test test/cleaner-portal.test.js
node --check src/cleaner-portal.js
node --check public/cleaners/portal.js
npx wrangler deploy --dry-run
```

Tests use Node's SQLite adapter and a mocked email provider; they do not send real emails. They cover identity separation, one-time codes, access control, signature order and locking, preservation of final cleaner rates, hash verification, withdrawal, outbox recovery, attachments and existing website routes. Browser signing and live email delivery still require the acceptance check above.
