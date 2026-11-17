# ProHouse Live With Us: Didit identity checks

## Status
The backend and both applicant forms are deployed, but the Didit service only activates when the main Cloudflare Worker `prohouse` has **DIDIT_API_KEY** (secret) and **DIDIT_WORKFLOW_ID** (plain-text config). The same workflow identifier used in the vendor preview is already in `wrangler.jsonc`. As of 17 November 2026, the production `prohouse` Worker did not have the secret. The ID-upload fallback therefore remains active to avoid preventing applications.

## Activate
1. In Cloudflare Dashboard, open **Workers & Pages → prohouse → Settings → Variables and Secrets**.
2. Add **DIDIT_API_KEY**, type **Secret**, using the valid key for the Didit workflow. **Never** commit the key to GitHub or paste it in chat.
3. Confirm **DIDIT_WORKFLOW_ID** is set to the relevant workflow for ID verification, selfie/liveness and face match. Current repository value is drawn from the existing vendor form's preview configuration.
4. Redeploy the Worker if prompted. `GET /api/longstay/identity/config` should return `diditAvailable: true` (no API key is returned).
5. Open `/operations/livewithus/` and the private second-applicant invitation page. The upload-a-photo-ID fields should disappear, the Didit button should appear, and income proof remains mandatory. Run a consented test verification with a real eligible tester before relying on it.

## Applicant workflow
- Enter legal name and email in the rental application.
- Consent to Didit processing ID images, selfie and facial/liveness data; open Didit's hosted session on `verify.didit.me`.
- Return to the original application tab and select **Check verification result**. No browser-supplied approval flag is accepted.
- On submission, ProHouse independently re-queries Didit's server decision. It requires `Approved` results for identity document, liveness and face match, and an exact normalised match between the ID name and the form's legal name.
- First and second applicants verify separately; second verification is restricted to the active, invited email and the original private joint-application reference.
- Admin PDF contains verification status, the verified name, provider session reference and checked timestamp. No ID images or selfie payloads are stored by ProHouse in the Didit pathway. Income proof PDF/image documents continue to be attached.
- Temporary records are stored in the private Cloudflare D1 `longstay_identity_sessions` table; random session tokens are stored only as SHA-256 hashes. Submitted checks are marked with their application references, preventing ordinary reuse. Unsubmitted checks expire and are cleaned hourly.
- The verification session-start rate is controlled by the site's `LONGSTAY_FORM_LIMIT`, with a rolling 31-day Didit tenant session cap configured by `DIDIT_LONGSTAY_MONTHLY_LIMIT` (50 production; 25 preview). This cap is advisory rather than an atomic usage reservation; monitor Didit costs separately.
- Without valid credentials, the original required-ID upload path remains in place. This fallback **is not** labelled Didit-verified.

## API endpoints
- `GET /api/longstay/identity/config` (non-sensitive readiness)
- `POST /api/longstay/identity/start` (consent, exact legal name, email, applicant role; invite token for second)
- `GET /api/longstay/identity/status` (only to holder of temporary random token)
- `POST /api/longstay/identity/status` (fetch Didit's decision server-to-server using the private API key)

Didit session calls use `POST https://verification.didit.me/v3/session/`; status uses `GET https://verification.didit.me/v3/session/{session_id}/decision/`. Returned session URLs are restricted to `https://verify.didit.me`. The API key is never exposed in the browser.

## Privacy and operational notes
ID documents and selfies are provided to Didit, a third-party identity provider. Applicants must consent and see Didit's current privacy policy: https://didit.me/terms/privacy-policy/. A successful identity check does not guarantee rental approval, employment status, or creditworthiness. If an applicant's verified ID includes middle names or differs from the legal-name fields, require correction or manual ProHouse assistance. The system does not accept a mismatched identity silently.

The site's existing required uploads are retained until Didit credentials exist to avoid a production outage. Removing that fallback before activation would block valid applications entirely.
