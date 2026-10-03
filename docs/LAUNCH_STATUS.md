# DAAKYKA Storefront — Launch Status

**Updated:** 2026-10-03
**Public soft-launch URL:** https://storefront-nu-woad.vercel.app

## Verified October 1 production baseline

The public alias served commit `48925bce1805664af213a4dac7a87963eecca8cd` as deployment `dpl_8VNBK4Uo8pwMyCGgMBqvufFkzzyX` on 2026-10-01. Its exact-commit local Docker gate passed: dependency audit, migrations and seed, lint, typecheck, 639 integration tests, production build, 53 core browser tests (two skips), 61 dogfood journeys, nine accessibility cases, nine Lighthouse mobile assertions, and a clean local link crawl. The AR Docker image passed nine tests and a health smoke. Check the current alias and `dogfood-output/local-ci/deployment-report.json` for a newer deployment receipt.

Post-deploy checks found 5/5 healthy probes, 27/27 populated navigation categories, 131 sitemap pages, 199 internal anchor targets, 145 rendered image targets, and no link or image HTTP failures. The reviewed manifest's 235 generated image keys are linked across 59 live product pages; their R2 objects and source references passed preflight. These are representative illustrations, not verified photographs of each size.

## Committed integration line after that baseline

The committed `integrate/main-20261003` history includes the local `master` theme refactor, the media-picker/gallery follow-up, and audit fix waves 4-5. Promote this line only from a clean, exact-commit local Docker release gate, with its deployment and hosted behavior recorded. Product hero video code is staged separately in the integration checkout; it has not passed the R2 video-host, carrier/device, and live playback launch gates.

GitHub's default branch is `master`, and the fetched `origin/master` is behind this release line. GitHub Actions are disabled; the supported verification path is `node scripts/local-release.mjs --deploy` from an exact clean commit, followed by the hosted audits in [LOCAL_CI_CD.md](./LOCAL_CI_CD.md).

## Open public-launch gates

- **Product proof:** The three-view colourway lower-bound gap is closed, but the listed 558 size variants still need owner verification or exact-size photography. Nine views for three source-photo-free colours are disclosed sibling-colour interpretations needing seller confirmation.
- **Payments and messaging:** The production environment has no Razorpay or Brevo variable names. Admin-saved credentials, real checkout capture, refund behavior, and message delivery have not been independently proved. WATI is also unconfigured in the visible Production environment list.
- **Admin access:** The existing hosted admin password does not match the seed value; authenticated admin operation and password rotation remain unverified.
- **Domain and indexing:** `robots.txt` currently disallows all crawlers. Verify the final domain, DNS, Search Console, and production configuration before enabling indexing.
- **Operations:** Check backup and restore, uptime and error alerting, incident contacts, credential scope and Preview environment hygiene, and a real customer journey before public launch. See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) and [GO_LIVE_RUNBOOK.md](./GO_LIVE_RUNBOOK.md).

The store is a working **soft launch**. A green code gate and a healthy public alias do not close the external commercial and product-accuracy gates above.
