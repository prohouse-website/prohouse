# ProHouse rental applications, review and future lease mail merge

## Live Operations URLs

- Operations Portal: https://www.prohouse.com.au/operations/
- Main application: https://www.prohouse.com.au/operations/livewithus/
- Second applicant private invitation: https://www.prohouse.com.au/operations/livewithus/second/#token=<private-token>
- ProHouse-only decision page: https://www.prohouse.com.au/operations/livewithus/review/#token=<private-review-token>
- The former /longstay/form/livewithus/ URLs redirect to their Operations Portal equivalents.

## Application and notification flow

- Applicant 1 submits a four-step form with legal/contact/work details, a *mandatory* uploaded photo ID (no ID-type dropdown) and proof of income, rental choices, and signature.
- PDF, JPEG, PNG attachments only (not WebP, which pdf-lib cannot embed as a page). Maximum 5 MB each, 15 MB combined.
- For one person, ProHouse gets **one PDF** that includes all application pages, the electronic signature and all supporting documents copied as PDF pages. The email contains an owner-only link to approve/reject.
- For two people, applicant 1 enters **only applicant 2's email**. ProHouse gets an interim single PDF with applicant 1 attachments. Applicant 1 gets an acknowledgement. Applicant 2 gets a **48-hour invitation** with applicant 1's name, email and shared rental preferences. It excludes first applicant's occupation, work-from-home, employer/school, income, signature and all uploaded files. Applicant 1 is warned exactly what is shared.
- Applicant 2 enters their legal/contact/work details, uploads their own mandatory ID and proof of income (without choosing an ID type), completes declarations, and signs. The first applicant's combined PDF is AES-GCM encrypted in private Cloudflare D1 chunks for the 48-hour invitation, allowing the second applicant's submission to produce **one final PDF** with both applicants' signatures and all supporting documents, without fetching old email attachments. After successful joint completion, the encrypted temporary document is deleted. For older invitation links without encrypted storage, a Resend attachment retrieval is attempted as a fallback. If that retrieval fails, the second submission still succeeds and ProHouse receives two admin emails with separate PDF attachments, explicitly labelled so neither applicant's evidence is lost.
- Email delivery to hi@prohouse.com.au uses RESEND_API_KEY and APPLICATION_FROM_EMAIL. Applicant status notifications never attach ID or income files. If legacy retrieval fails, the final admin email explicitly instructs staff to consult the original first-person PDF in its earlier email.
- Invitation token is random (256 bits), kept hashed in D1. It is provided in URL fragment, not normal page request. Invitation automatically rejects late submissions after 48 hours. D1 holds applicant 1 text/signature and encrypted first-person PDF chunks temporarily. The text, signature, and document chunks are deleted on joint completion; expired document chunks are cleaned during scheduled housekeeping.
- Staff review link is a distinct hashed 256-bit capability, only emailed to ProHouse. It expires after **30 days**, displays the application data, and requires a separate button click to approve/reject. The POST decision uses a conditional pending-only database transition. Applicant(s) and ProHouse receive status emails. Approval is **only permission to prepare a lease**, not an executed tenancy or guaranteed move-in.
- A separate private longstay_reviews row stores approved/rejected application text for subsequent lease data merge. Cleanup currently deletes review rows after 90 days. Confirm retention requirements before moving to production-scale tenancy document management. First applicant ID and income documents are temporarily present **encrypted** inside the combined first-person PDF in private D1 chunks until the second applicant completes or the invitation expires. The signed joint application and attachments are then retained in ProHouse's email inbox, not exposed on public URLs.

## Future lease-template input: what ProHouse must upload/provide

**1. Actual lease master files.** Supply your latest master lease as DOCX or fillable PDF, ideally separately for NSW and Victoria. Provide annexures, special conditions, house rules, inventory/furniture schedules, privacy/consent terms, any optional parking or inclusions addendum, and the statutory documents/disclosures required for each state. A scan-only PDF is usable but requires manual positional field-mapping.

**2. Legal party data.** Landlord/lessor's correct legal entity (not just trading name), ACN/ABN if relevant, authorised agent and contact/service address, agent signing representative and signature workflow. Confirm whether ProHouse is owner, managing agent or head tenant for each property and rental arrangement.

**3. Property-specific constants.** Full street address, unit number, postcode, state, room identifier, whether the arrangement is a rooming house, boarding house, co-tenancy or ordinary residential tenancy, common areas/room descriptions, included appliances, electricity/internet/water arrangement, rent payment details, residential bond scheme/amount and optional services.

**4. Terms that cannot be inferred from the application.** Accepted (not merely *proposed*) weekly rent; agreed commencement/end dates; exact fixed term; bond amount; billing/payment arrangements; occupant(s); permitted visitors; utilities/inclusions; any lawful special conditions; and any approval dependencies. These need confirmation before mail merge, not blind copying from proposed rent or preferred move-in date.

**5. Preferred signing process.** Who signs first (ProHouse or tenant), how signatures are gathered and verified, whether each co-applicant signs separately, how to present the document for review, email sender/recipients, what to do on decline, and whether signed leases are archived and for how long.

After the templates are attached, use `src/longstay-pdf-template.js` for fillable PDF AcroForms or implement position overlays for flat PDFs. Use application fields exported in `src/longstay-application.js`, and only use rows in `longstay_reviews` whose status is `approved`. The existing code **does not** automatically issue, sign, or send lease documents; that must be implemented after verifying the templates and Australian state requirements.

## Current Cloudflare resources

- D1 binding LONGSTAY_DB: production prohouse-longstay-applications; independent preview database.
- Table longstay_applications contains invitations, first emailed-PDF ID and first-summary page count; longstay_reviews stores staff decisions and approved applicant text.
- Cloudflare Workers rate limit LONGSTAY_FORM_LIMIT; daily cleanup.
- R2 is **not enabled** on this Cloudflare account. The joint document merger uses a temporary, AES-GCM-encrypted PDF in Cloudflare D1 chunks instead. Older invitations may fall back to secure Resend attachment access. No public application document URL is created.

## Security and operational caveats

- Never post, log, or share any private invitation or approval token. A staff link is *bearer access*; whoever obtains it before it is used can review or decide the application. For greater security, add Cloudflare Access/staff login before multi-user use.
- The internal form is not a tenancy agreement. Any lease must be separately prepared and signed according to NSW/Victorian requirements.
- Real mailbox acceptance and Cloudflare D1 document escrow should be tested with non-sensitive synthetic documents before unattended live intake. Automated workflow tests use mocked Resend and real PDF merge/encryption logic.

## Applicant UX fixes (15 November 2026)

- First and second applicants now **upload photo ID directly**, without being required to select "Passport" or "Driver licence" from a dropdown. Mandatory ID and income proof file validation remains unchanged.
- Preferred payment frequency offers **Fortnightly (every 2 weeks)**, **Every 4 weeks**, and **Every calendar month** only. Weekly is rejected server-side.
- The first-person laptop signature canvas is sized **when step 4 becomes visible** (not while hidden), resolving zero-width drawing on trackpads. The second-person canvas receives the same visibility fix.
- Both forms offer an optional **Sign on phone: Show QR code** action. A 256-bit bearer token valid for 15 minutes opens a separate first-party phone signing page. Only the signature image is transferred, not ID, income files or form contents. The desktop polls to import the image and the applicant still submits the original form normally.
- QR encoding uses a **self-hosted MIT-licensed QRCode.js**, with no third-party QR request or user token sharing.
- For legacy joint invitations where the first PDF cannot be fetched, the second applicant still completes. The admin email subject becomes **REVIEW REQUIRED: TWO PDF EMAILS** and refers staff to the earlier email containing first-person ID and income documents.
