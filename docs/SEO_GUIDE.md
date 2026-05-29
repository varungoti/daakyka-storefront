# SEO Guide

## Architecture

| Layer | Location |
|---|---|
| Guide landing pages | `/guides/[slug]` — `src/data/seo-landing-pages.ts` |
| Short URL redirects | `/doctor-scrubs` → `/guides/doctor-scrubs` via `next.config.ts` |
| Fabric tech SEO | `/4-way-stretch-scrubs` → `/fabric-technology/4-way-stretch` |
| Guides hub | `/guides` |
| Blog | `/blog/[slug]` — CMS + seed data |
| Sitemap | `/sitemap.xml` auto-generated |
| Robots | `/robots.txt` |

## Each Guide Includes (Part 10.2)

- H1 + search-intent intro
- Why DAAKYKA bullets
- Buying guide steps (where relevant)
- Product module (best sellers or category)
- Trust signals
- Related guides, collections, blog posts
- FAQ section + FAQPage JSON-LD
- BreadcrumbList JSON-LD

## Global Schema

- **Organization** + **WebSite** — every page via `GlobalJsonLd`
- **Product** + **BreadcrumbList** — product pages
- **FAQPage** — guide pages

Validate in `/admin/seo` → Schema Validation panel.

## Adding a New Guide

1. Add entry to `seoLandingPages` in `src/data/seo-landing-pages.ts`
2. Set `path`, `slug`, meta, FAQs, related links
3. Redirect is automatic via `next.config.ts`
4. Rebuild — static params generated from array
5. Verify in SEO Manager audit table

## Admin SEO Manager

`/admin/seo` — audits title length, meta description length, H1 presence for static pages + guides + published blog posts.

## LLM / GEO Tips (Part 10.3)

- Use clear definitions and numbered buying guides
- FAQ schema on every commercial guide
- Internal links between related guides and collections
- Consistent entity language: "DAAKYKA Apparels", "Babaji Enterprises", "Pan India"
- Original content — avoid duplicating blog and guide verbatim

## Post-Launch

1. Submit sitemap in Google Search Console
2. Rich Results Test on homepage, one product, one guide
3. Monitor `/admin/reports` for SEO pages needing work
