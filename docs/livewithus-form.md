# ProHouse rental applications, review and future lease mail merge

## Live Operations URLs

- Operations Portal: https://www.prohouse.com.au/operations/
- Main application: https://www.prohouse.com.au/operations/livewithus/
- Second applicant private invitation: https://www.prohouse.com.au/operations/livewithus/second/#token=<private-token>
- ProHouse-only decision page: https://www.prohouse.com.au/operations/livewithus/review/#token=<private-review-token>
- The former /longstay/form/livewithus/ URLs redirect to their Operations Portal equivalents.

## Application and notification flow

- Applicant 1 submits a four-step form with legal/contact/work details, photo ID category (Australian-issued driver licence or passport), *mandatory* photo ID file and proof of income, rental choices, and signature.
- PDF, JPEG, PNG attachments only (not WebP, which pdf-lib cannot embed as a page). Maximum 5 MB each, 15 MB combined.
- For one person, ProHouse gets **one PDF** that includes all application pages, the electronic signature and all supporting documents copied as PDF pages. The email contains an owner-only link to approve/reject.
- For two people, applicant 1 enters **only applicant 2's email**. ProHouse gets an interim single PDF with applicant 1 attachments. Applicant 1 gets an acknowledgement. Applicant 2 gets a **48-hour invitation** with applicant 1's name, email and shared rental preferences. It excludes first applicant's occupation, work-from-home, employer/school, income, signature and all uploaded files. Applicant 1 is warned exactly what is shared.
- Applicant 2 enters their legal/contact/work details, ID category, own mandatory files, declaration and signature. The service retrieves applicant 1's sent PDF from the authenticated Resend outbound-attachments API, copies only its supporting-document pages, and adds them to a joint application summary and applicant 2's supporting-document pages. ProHouse gets this **one final PDF**, with all uploaded evidence from both people, and a private approve/reject link. Applicant 1 and applicant 2 receive completion emails.
- Email delivery to hi@prohouse.com.au uses RESEND_API_KEY and APPLICATION_FROM_EMAIL. Applicant stage notifications never attach ID or income files. If the first applicant's PDF cannot be retrieved, the second submission does not falsely report a successful combined application.
- Invitation token is random (256 bits), kept hashed in D1. It is provided in URL fragment, not normal page request. Invitation automatically rejects late submissions after 48 hours. D1 holds applicant 1 text/signature temporarily, and clears them after both applicants submit.
- Staff review link is a distinct hashed 256-bit capability, only emailed to ProHouse. It expires after **30 days**, displays the application data, and requires a separate button click to approve/reject. The POST decision uses a conditional pending-only database transition. Applicant(s) and ProHouse receive status emails. Approval is **only permission to prepare a lease**, not an executed tenancy or guaranteed move-in.
- A separate private longstay_reviews row stores approved/rejected application text for subsequent lease data merge. Cleanup currently deletes review rows after 90 days. Confirm retention requirements before moving to production-scale tenancy document management. No photo IDs are stored in D1. First applicant's merged PDF can be fetched from Resend after submission, and the finished package stays in ProHouse's email inbox.

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
- R2 is **not enabled** on this Cloudflare account. Instead the joint document merger reads applicant 1's sent PDF from the existing Resend email attachment, authenticated server-side; no public application files are exposed.

## Security and operational caveats

- Never post, log, or share any private invitation or approval token. A staff link is *bearer access*; whoever obtains it before it is used can review or decide the application. For greater security, add Cloudflare Access/staff login before multi-user use.
- The internal form is not a tenancy agreement. Any lease must be separately prepared and signed according to NSW/Victorian requirements.
- Real mailbox acceptance and the Resend attachment retrieval should be tested with non-sensitive synthetic documents before relying on unattended joint PDF delivery. Automated workflow tests use mocked Resend and PDF pages.
