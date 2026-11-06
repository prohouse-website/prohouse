# ProHouse Stay & Property Guides

Public hub: https://www.prohouse.com.au/blog/

## Authoring and build

Edit `content/blog/posts.json`, then run:

```sh
node scripts/build-blog.mjs
node scripts/check-seo.mjs
```

The build creates the blog hub, article HTML, RSS feed and blog sitemap entries. It reuses the site's header and footer from `public/why-prohouse/index.html` and scopes article styles to `.blog-page`. It preserves non-blog sitemap entries. Generated HTML must be committed with its content source. Publishing does not require a runtime content API or new credentials.

Each article needs a unique stable slug, title, description, category, actual publication date, introduction, useful sections, source links and a relevant booking or owner-enquiry link. `modified` is optional and changes only after a substantial factual/content update. Author attribution is the ProHouse organisation; do not claim Brian personally authored or reviewed an article unless he did.

## Standing publishing authorisation

Brian authorised automatic blog creation and ongoing publication on 6 November 2026. Research/check daily; publish at most one useful new article on Tuesday and Friday in Australia/Sydney, initially two articles a week. The launch collection has four articles, with three guest guides and one owner guide. Maintain that approximate 3:1 balance across the collection. Quality and factual accuracy take precedence over a quota; skip publication when nothing distinct and useful is ready.

Use a separate branch and pull request. Inspect the exact-head diff, run source SEO checks, wait for successful CI and a successful matching Cloudflare preview, inspect rendered preview pages, then merge the blog change without asking for another approval. Verify the resulting production URLs. If preview or checks cannot be verified, keep the change unmerged and report the blocker. Do not change account/build settings to bypass the workflow.

This authorisation covers article content, generated blog pages, the RSS feed and their sitemap entries. The initial launch also adds a footer link to the guides on public marketing pages. Unrelated website changes still use the existing approval workflow. Never merge another person's unrelated PR or a rejected PR as part of blog work.

## Editorial boundaries

- Write for an actual guest or property-owner question. Use search data where available, but do not turn isolated low-volume queries into confident demand claims.
- Keep the airport landing page as the booking page. Blog guides answer distinct supporting questions and link to appropriate existing pages.
- Prefer ProHouse's actual property information and original operational explanations. Do not invent stays, testimonials, reviews, experience, facilities, prices, travel times, income projections or offers.
- Check time-sensitive facts using current authoritative sources. Avoid quoting fees or legal requirements unless verified. Do not infer eligibility, approvals, insurance cover or financial returns.
- Keep private rooms in shared apartments distinct from whole-apartment bookings. Wolli Creek is not Sydney CBD or inside the airport terminals.
- Use relevant internal links and helpful source links. Avoid copied articles, bulk keyword variants, unrelated subjects and artificial freshness dates.
- Do not add tracking, contact customers, send outreach, change rates or booking policies, alter Hostex widgets or touch any survey/review code or routes.
- Brian explicitly rejected PR #22. Preserve the current review workflow, including automatic Google Reviews opening for overall ratings of 4–5; never re-propose that PR's changes.

## Reporting

Report newly published/updated URLs, successful checks and factual/access blockers. Use actual Search Console metrics with date ranges. Treat public search observations separately from measured Google rankings. No claim of first-place placement, sitemap submission or indexing request without evidence.
