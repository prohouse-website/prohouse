# ProHouse Live With Us: lease approval, signing and 24-hour payment workflow

## From application to completed agreement

1. Applicant(s) submit Live With Us. ProHouse receives all application documents as one PDF by email.
2. ProHouse reviews the application in the private email link and clicks **Approve application**. This is not approval of a lease.
3. The Operations review page opens an **editable Schedule A lease editor**. First and second applicant names/emails/phones, rented room, proposed weekly rent, preferred start date and a suggested end date are prefilled from the application. ProHouse may edit every Schedule A field: names, contacts, rent, dates, charges, deposits, PayID/bank details, full address, room and signing representative.
4. Staff clicks **Save changes & preview complete PDF**. The site saves a confidential six-page draft PDF with a prominent LEGAL REVIEW REQUIRED / NOT FOR SIGNING footer. When a saved master PDF exists, no re-upload is needed. When preparing a new master, staff first uploads a six-page PDF version of the agreement and checks **Save this master PDF**. Only the Schedule A area is merged.
5. Staff reviews the actual six pages in the embedded PDF. If anything is wrong, they edit fields and regenerate a fresh preview. **Approve final lease & email tenants** is a distinct control, enabled only after the staff member ticks legal review, final terms and 24-hour deadline acknowledgements.
6. On releasing the lease, the Worker creates a signable copy (without preview watermark), stores it as a restricted D1 BLOB, issues random 256-bit private email signing links to each named tenant, and starts a 24-hour UTC deadline. ProHouse gets a separate email with the released PDF.
7. Each tenant sees the full PDF, downloads it if desired, confirms they read all six pages, consents to electronic signing, enters their exact legal name, and draws their **own signature**. The first/second application signatures are *not* transplanted to the lease.
8. Within the same 24-hour deadline, tenants must **pay one week of rent in advance** using the approved PayID or bank details and **report their bank transaction reference** in the signing page. This one-week payment is **per rental agreement**, not once per tenant. The page clearly says reporting does not prove funds cleared.
9. After each signature, ProHouse is emailed a status update; when all tenants sign, ProHouse receives a PDF with tenant signatures. When payment is reported, ProHouse receives an unverified payment notice.
10. ProHouse checks its bank account and explicitly marks the **full one-week rent payment verified**. The backend compares the verified amount to the lease's approved weekly rent.
11. Only when all tenants have signed **and** bank verification is recorded does the ProHouse signature form unlock. The authorised representative requests a **6-digit code** delivered to hi@prohouse.com.au, valid for 10 minutes (5 incorrect attempts maximum), signs on the website, and confirms issuance.
12. The Worker generates a final PDF with both tenant signatures (if applicable), ProHouse's signature, dates and a separate electronic audit page. The completed PDF is emailed to each tenant and to hi@prohouse.com.au. It is also available from the restricted portal.

## Deadlines and exceptions

- The 24-hour deadline starts at **lease release**, not at application approval.
- Both signatures and a payment report must be submitted before the deadline. Bank clearing/ProHouse verification may take longer.
- Access beyond the deadline is blocked for incomplete signing/payment; hourly Cloudflare scheduled checks flag and email the ProHouse mailbox when incomplete.
- Expiry is **not** treated as a lawful ground to impose a penalty, retain money, evict, terminate an already existing tenancy or re-let automatically. Staff must determine any follow-up.
- All approval and signing links use hashed bearer tokens stored in a private database. They are sensitive; do not forward. Staff final countersignature additionally requires the short-lived email code.
- No proof of receipt is inferred from a payment report. No PayID bank API integration or automatically confirmed payment has been implemented.
- The signed document and separate status metadata stay in a private Cloudflare D1 database, with email copies sent via Resend. D1 single-value limit is 2 MB; template PDF and signed PDF must be small enough.
- No offline identity verification is performed by e-signature itself. Document/ID verification remains a separate ProHouse duty.
- This workflow does not automatically lodge a rental bond, deliver a condition report or ensure compliance with required statutory tenancy forms.

## Current components

- Operations Portal: `/operations/`.
- Application: `/operations/livewithus/`.
- Admin private review: `/operations/livewithus/review/#token=...`.
- Tenant signing: `/operations/livewithus/sign/#token=...`.
- HTTP routes:
  - POST `/api/longstay/lease-prepare`
  - GET `/api/longstay/lease-status`
  - GET `/api/longstay/lease-pdf`
  - POST `/api/longstay/lease-send`
  - GET `/api/longstay/tenant`
  - POST `/api/longstay/tenant-sign`
  - POST `/api/longstay/tenant-payment`
  - POST `/api/longstay/payment-verify`
  - POST `/api/longstay/provider-otp`
  - POST `/api/longstay/provider-sign`
- Private database tables `longstay_lease_packets` and `longstay_lease_templates`, binding LONGSTAY_DB.
- Hourly cron `0 * * * *` for deadlines, daily cron retained for existing maintenance/ShareBill tasks.
- Tests: `test/longstay-signing.test.mjs`, `test/longstay-pages.test.mjs` and original application workflow tests. All email calls in tests are **mocked**; run a controlled synthetic applicant/transfer exercise before accepting real tenant signatures.

## Legal review gate

The uploaded ProHouse agreement currently contains self-eviction, lock-changing and charges that may be inconsistent with NSW/Victorian tenancy law. ProHouse must determine whether each address is residential tenancy, rooming house, occupancy or another lawful arrangement, and obtain an approved master for that state. Tick the legal-review confirmation **only** after the correct legally reviewed master is uploaded. Signable issuance is enabled by staff confirmation but the website cannot itself provide legal validation.

In NSW, a one-week upfront **rent-in-advance** amount is within the usual legal limit of two weeks, but a one-week **holding deposit** has distinct 7-day and credit-to-rent obligations. In Victoria, advance rent and holding deposits have different rules, including different refund/credit treatment. Staff must not treat the one-week rent reported in this workflow as a refundable bond or holding fee without the legally required separate handling.
