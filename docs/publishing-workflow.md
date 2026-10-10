# Publishing ProHouse

The production source is this repository. Cloudflare Workers Builds is connected to the existing `prohouse` Worker.

## Normal updates

1. Make changes on a separate branch and open a pull request into `main`.
2. Wait for the Cloudflare preview build and open its preview URL.
3. Check the homepage, changed pages, images, navigation and booking links. Test the survey only when preview runtime secrets are configured.
4. Get Brian's approval before merging.
5. Merge into `main`. Cloudflare runs `npx wrangler deploy` automatically.
6. Confirm the production build succeeded and check the live website.

## Configuration

- Worker name: `prohouse`.
- Static assets: `./public`; keep website files inside `public/`.
- Worker entry point: `src/worker.js`.
- Survey handler: `src/survey.js`.
- Production branch: `main`.
- Project root: repository root.
- Preview command configured in Cloudflare: `npx wrangler preview`.
- Preserve the working Wrangler configuration when changing website design.

## Survey email

The survey requires `RESEND_API_KEY` as a runtime secret and `SURVEY_FROM_EMAIL` as a runtime variable. Production and preview configuration are managed separately in Cloudflare. Build-time secrets do not configure the running survey.

Keep API keys out of Git, public website assets and pull request descriptions. `.dev.vars` is for local development and is excluded from Git.

## Failed builds

Open the failed Cloudflare build and inspect its log. Fix the branch and push another commit before merging. ZIP copying and manual backup folders are no longer the normal publishing workflow.
