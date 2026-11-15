# ProHouse mutual rental agreement: uploaded DOCX template mapping

Source supplied by ProHouse: `Mutual rental agreement-v9 090924.docx` (document itself displays `v10-20261125` on page 1). The document is SIX A4 pages. Pages 1-5 are "Mutual rental agreement - Terms and Conditions". Page 6 is `Schedule A`; it is a table containing empty cells and signature lines, **not native Word form controls**. Map only the Schedule A value cells. Never replace clauses 1-5 during mail merge without explicit owner authorisation.

A Word merge-ready DOCX and six-page PDF copy were produced in this conversation. The live website's private owner approval page now includes `Prepare Schedule A draft`; it accepts the *six-page PDF conversion of the uploaded Word document* plus approved financial/term values. It currently requires that PDF to be selected by staff for each draft: the binary source file is not automatically stored in the website repository. All generated PDFs have a visible legal-review draft footer, and are **not emailed to tenants automatically**.

## Source Schedule A to approved-application mapping

| Source PDF page 6 field | From application | What ProHouse must confirm |
| --- | --- | --- |
| GUEST(s) Name | firstName + lastName; optionally secondFirstName + secondLastName | Correct legal spellings |
| Email, mobile | email, phone; secondEmail, secondPhone | Confirm contact details if updated |
| Rented premises address | property, propertyOther | **Full street/lot/unit address required**; short property label insufficient |
| Rented area | room / roomOther | Confirm exact room |
| Weekly rate | weeklyRent as **proposal only** | `acceptedWeeklyRent` required: approved rent, not automatically the applicant offer |
| Payable on | payFrequency as **preference only** | `rentFrequency` required: agreed frequency |
| Internet, Electricity/Gas, Water | Template defaults $30/month, equally split, equally split | Confirm or alter `internet`, `electricity`, `water` |
| PayID | Existing template's hi@prohouse.com.au | Verify it is still correct |
| Bank BSB-Acc | Existing 067 873 - 1998 7232 | Verify or provide confirmed bankDetails |
| STARTING / ENDING | moveIn preference and length not sufficient | Both `leaseStart` and `leaseEnd` required |
| Refundable cleaning bond | No application field | Explicit `cleaningBond` (including 0 if none) |
| Refundable holding fund | No application field | Explicit `holdingFund` (including 0 if none) |
| GUEST 1, GUEST 2, AGENT/PROVIDER signature name | Names mapped from the approved application; provider representative entered by staff | **Signature and signing dates always blank**, for separate execution |
| PROVIDER/OWNER | Currently says “ProHouse Rental on behalf of Cu NGUYEN” | Verify the exact legal entity, capacity and authority |
| No-access areas | Template says “Other bedrooms, garage.” | Confirm property-specific restrictions before signing |

## Deployment

- `src/longstay-lease.js` exports `fillMutualAgreementPDF` and `generateMutualLeaseDraft`.
- Secure admin-only-by-private-review-link route: `POST /api/longstay/lease-draft`.
- Accepts the reviewed application token and six-page PDF template in form-data, plus staff-confirmed terms. Requires review status `approved`. PDF output is downloaded only, never automatically sent or signed.
- The first five pages retain the source document's original PDF content. Page 6 receives value overlays at validated PDF coordinates. A conspicuous disclaimer footer is added to all six pages. To obtain a final signable lease, ProHouse must use a legally reviewed master agreement.
- Staff UI: `/operations/livewithus/review/` in `public/operations/livewithus/review/index.html`.
- GitHub tests: `test/longstay-workflow.test.mjs` verifies approved-only generation, six-page PDF structure, and confirmation of financial fields.

## Critical legal review flags

This is not legal advice. Do **not** send the current source agreement for signing before an appropriately qualified Australian property lawyer identifies the correct type of agreement and reviews the clauses, especially for room-by-room arrangements and differences between NSW and Victoria.

- Clause **1.2** states the agreement is not governed by the NSW Residential Tenancies Act and authorises eviction without a court order; such a declaration does not on its own determine legal applicability.
- Clauses **4.1**, **5.1-5.3** contemplate two-day/immediate eviction, changing locks or forfeiting deposits without court processes.
- Clauses **2.10.1**, **4.3.2-4.3.3** impose daily late rent fees and admin surcharges; review against relevant state law.
- Schedule A refers to **cleaning bond** and **holding fund**, rather than the bond/holding mechanisms potentially required by law.
- The title displayed inside the uploaded Word file (`v10-20261125`) differs from its filename (`v9 090924`); confirm which is operative.
- NSW Fair Trading residential agreement guidance and Consumer Affairs Victoria residential and rooming-house agreement guidance should be considered, and the applicable classification confirmed for each property.

The current deployment is an **internal draft generator only**. Lease document sending, e-signature, bond handling, and legal compliance are not represented as implemented.
