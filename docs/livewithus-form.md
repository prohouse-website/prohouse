# ProHouse Live With Us form

Page: https://www.prohouse.com.au/longstay/form/livewithus/

Endpoint: POST /api/longstay/application (multipart form-data). Handles all fields, a PNG-drawn signature, and optional document uploads. Returns a unique LH-... application reference only after Resend accepts the email. No public link, R2 bucket or persistent database holds application documents.

Delivery: RESEND_API_KEY secret, APPLICATION_FROM_EMAIL sender (fallback CLEANER_FROM_EMAIL), and PROHOUSE_ADMIN_EMAILS (first configured address; currently hi@prohouse.com.au). Email text contains every field; attachments contain the generated signed application summary PDF and each uploaded document. Per file 5 MB, combined 15 MB, only PDF/JPG/PNG/WebP. Emails with attachments are subject to Resend account allowances.

## Key mapping for the future branded PDF

The canonical field keys are exported as `applicationFields` from `src/longstay-application.js`:

```
people,houseRules,firstName,lastName,email,phone,occupation,occupationOther,workFromHome,workFromHomeOther,employer,income,secondFirstName,secondLastName,secondEmail,secondPhone,property,propertyOther,room,roomOther,moveIn,length,weeklyRent,payFrequency,linen,linenOther,declaration,privacyConsent
```

Documents: photoId1, photoId2, incomeProof1, incomeProof2, secondId, secondIncome. `signature` is a PNG data URL from the signature pad. The current email PDF draws the signature and a full text summary.

Template hook: `mergeApplicationTemplate(templateBytes, application, fieldMap, options)` in `src/longstay-pdf-template.js` can fill a later-supplied *fillable* PDF when the user's template fields match the keys or a fieldMap is supplied. A flat, non-fillable template needs positional mapping after the PDF is reviewed; then wire the template into the submission handler. Uploading the template to the chat does not automatically deploy it.

## Operational and compliance notes

- This page is an application, not a residential tenancy agreement; no lease is executed on submit.
- ID uploads are optional and specifically labelled 'only if requested'. NSW Fair Trading advises minimising unnecessary identity documents; new privacy requirements may require further process changes.
- The old Zoho clauses for eviction without a tribunal and automatic payment administration fees are not repeated. ProHouse should have its current tenancy terms reviewed for NSW compliance.
- Application files are sensitive personal information delivered by email. Keep mailbox access restricted, review retention/deletion, and consider a private document vault for higher application volume.
- The form does not persist partially completed drafts or personally identifiable data in browser local storage.
