# ProHouse Live With Us | first applicant + joint applicant

Live primary URL: https://www.prohouse.com.au/longstay/form/livewithus/

Private second-person invitation page: https://www.prohouse.com.au/longstay/form/livewithus/second/#token=<one-time-private-token>

Owner mailbox: hi@prohouse.com.au (via PROHOUSE_ADMIN_EMAILS); Resend integration uses RESEND_API_KEY and APPLICATION_FROM_EMAIL.

## Workflow

1. Person 1 completes the screening, contact/work details, property and room selection, rental preferences, signature and mandatory photo ID **plus** proof of income. Allowed PDF, JPEG, PNG, WebP, maximum 5 MB per file, 15 MB combined. Optional extra files. On successful owner delivery, owner receives the first-person PDF with signature and all uploaded documents; person 1 receives a receipt.
2. If Person 1 selected two people, the first submission needs **only Person 2's email**. The system stores invitation metadata and Person 1's completed text fields and PNG signature in the dedicated private D1 database, but never their uploaded documents. Person 2 receives a 21-day, unguessable 256-bit link, with the values Person 1 entered (including first applicant's contact, occupation, income and shared rental details), but no files or signature. Applicant 1 explicitly consents to sharing their entered data. Person 1 and ProHouse receive a second-applicant-invited status email. If the invitation fails, both are alerted.
3. Person 2 opens the private link and fills out their own legal name, phone, occupation, working-from-home status, employer/school, weekly income, photo ID and proof of income, declarations and signature. They cannot change Person 1's data. Person 2 submits to /api/longstay/coapplicant, where the system creates a **joint PDF with both signatures**. ProHouse receives the completed PDF and person 2 documents; person 1 documents are in the initial email. Both applicants are emailed completion notifications, and the first applicant's temporary application data and signature are removed from D1.
4. Person 1, person 2 and ProHouse get stage-related emails. Status and delivery errors are logged server-side. The system has a daily scheduled cleanup of expired D1 invitations and completed metadata.

## Endpoints

- POST /api/longstay/application: first applicant form submission, with multipart files.
- GET /api/longstay/invitation?token=...: temporary preview of first person's entered text fields for the invited applicant only. Not indexed; cache disabled. The emailed link carries the token in the URL fragment, preventing it from being sent in ordinary page request URLs.
- POST /api/longstay/coapplicant: complete second applicant with invite token, required documents, signature; updates DB to completed, sends attachments by Resend.
- Database: dedicated production D1 binding LONGSTAY_DB (prohouse-longstay-applications), isolated preview database; schema in schema/longstay-applications.sql.
- Optional Cloudflare edge rate limit LONGSTAY_FORM_LIMIT (5 submissions per IP per minute).

## Properties / room mappings

- VIC - Oakden Crescent, St. Albans: Master room with ensuite; Left room near stairway; Right room near bathroom
- NSW - Guess Avenue, Wolli Creek: Room near entrance; Master bedroom with ensuite; Small room near kitchen
- NSW - Arncliffe Street, Wolli Creek: Room 1; Room 2 (near kitchen); Room 3 (near entrance)
- Other: a manually entered property and room

Length: 3 / 6 / 12 months, or custom text. Weekly rent input is the amount the applicant wishes to pay. The display calculates fortnight, four-week and calendar-month equivalents.

## Future PDF mail merge

src/longstay-pdf-template.js includes a fillable PDF merge helper for a future branded application template. src/longstay-application.js exports canonical `applicationFields` and a branded PDF summary with both e-signatures. After the user uploads the template, map AcroForm field names (or positional coordinates for flat PDFs), wire the template and deploy. This part needs the actual PDF template before it can be completed.

## Security / compliance considerations

- Applicant files go to ProHouse's restricted mailbox only. No R2 file URLs, no long-term document storage within D1. Email copies are subject to mailbox and Resend retention; apply mailbox access controls and internal document-deletion procedures.
- Only a token hash is persisted, never the raw invitation token. Expiration after 21 days. Invitations can be redeemed only once; concurrent submissions cannot both deliver.
- ProHouse has not automatically approved a tenant or executed a lease; the eventual agreement is subject to NSW or Victorian residential tenancy law.
- The website requires applicant consent to share first applicant text fields with the nominated invitee. Verify the invitee email address carefully. Identity documents and signatures are not included in the invitation.
- This deployment does not send followup reminders automatically and does not include an admin resend-invitation dashboard.
