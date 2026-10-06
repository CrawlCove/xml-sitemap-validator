# Changelog

## 1.0.1 — 2026-10-06

- Fixed: a sitemap that starts with an `<?xml-stylesheet ...?>` processing
  instruction (Yoast, Rank Math and most WordPress sitemaps do) was reported
  as `wrong-root: root element is <?xml-stylesheet>`. Processing instructions
  are now skipped when locating the root element.
- When the sitemap URL redirects (`/sitemap.xml` to `/sitemap_index.xml` is the
  common case) the report records `redirectedTo` and the CLI prints it beside
  the requested URL.

## 1.0.0 — 2026-09-29

Initial release.

- `sitemap-validator <url>`: a sitemap URL, or a site URL (discovers the
  sitemap from robots.txt `Sitemap:` lines, else `/sitemap.xml`).
- Validates `<urlset>` and `<sitemapindex>` (children fetched and validated,
  `--max-sitemaps`), gzip transparently, against the sitemaps.org protocol
  and the 50,000-URL / 50 MB limits.
- Findings: `not-found`, `fetch-error`, `not-xml` (with an HTML-page hint),
  `wrong-root`, `missing-namespace`, `empty`, `too-many-urls`, `too-large`,
  `invalid-loc`, `cross-host-loc`, `duplicate-loc`, `invalid-lastmod`,
  `future-lastmod`, `invalid-changefreq`, `invalid-priority`,
  `too-many-sitemaps`, and with `--check-urls N`, `url-not-ok` for listed
  URLs that do not return 200.
- `--fail-on error|warning|none`, `--json`.
