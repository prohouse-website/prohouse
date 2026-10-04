EASY-EDIT VERSION

SURVEY UPDATE (OCTOBER 2026)
The guest survey lives at /survey and sends email through a Cloudflare Pages
Function. Read SURVEY_EMAIL_SETUP.txt first. The older static-only deployment
steps below do not activate survey email delivery. Use Wrangler or Git for this
version, and set the email secret in Cloudflare before publishing the survey.

Start with EASY_EDIT_GUIDE.txt.
Most routine changes are in data/site-config.js and data/properties.js.

PROHOUSE WEBSITE — READY-TO-PUBLISH STATIC SITE

WHAT IS INCLUDED
- index.html — redesigned homepage
- stays.html — Room 1, Room 2, Room 3, corporate/relocation
- location.html — Wolli Creek / Sydney Airport
- why-prohouse.html
- owners.html
- contact.html
- policies.html
- 404.html
- robots.txt
- sitemap.xml
- assets/styles.css
- assets/site.js

BOOK DIRECT
Every booking CTA points to:
https://www.prohouse.com.au/book

IMPORTANT BEFORE LAUNCH
1. Replace stock apartment photos with ProHouse's own photos when convenient.
2. Confirm the public contact email. The contact page currently uses Hi@prohouse.com.au.
3. Copy the latest approved legal/policy wording from the existing Google Sites pages into policies.html.
4. Test every booking link on desktop and mobile.
5. Keep the existing Google Site live until the new domain setup is confirmed.

FREE HOSTING RECOMMENDATION: CLOUDFLARE PAGES
This site is static HTML/CSS/JS and needs no server/database.

Option A — easiest manual upload:
- Cloudflare Dashboard > Workers & Pages > Create > Pages > Upload assets / Direct Upload
- Upload the contents of this folder (or the ZIP if the dashboard accepts it)
- Cloudflare will give you a *.pages.dev test address
- Test the site first
- Add www.prohouse.com.au as a custom domain only after testing

Option B — GitHub deployment:
- Create a GitHub repository
- Upload these website files
- Cloudflare Pages > Create project > Connect to Git
- Framework preset: None
- Build command: leave blank
- Build output directory: /
- Deploy

CUSTOM DOMAIN
Because your DNS is already intended to be managed with Cloudflare:
- Add www.prohouse.com.au in the Pages project's Custom domains screen.
- Let Cloudflare create/adjust the required DNS record.
- Do NOT delete unrelated MX/email records.
- After www works, decide whether prohouse.com.au should redirect to www.prohouse.com.au.
- Keep the old Google Site connected until Pages confirms the custom domain is active.

DESIGN
Primary navy: #17232F
Gold: #B89A62
Cream: #F7F5F0

PHOTO NOTE
The current package uses externally hosted editorial/stock images to make the site immediately previewable.
For production, ProHouse's own property photography is strongly preferred.
