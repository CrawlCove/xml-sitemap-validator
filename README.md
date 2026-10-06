# crawlcove-sitemap-validator

An XML sitemap validator for the command line: point it at a sitemap (or just your site) and it checks the XML against the sitemaps.org protocol and the limits search engines enforce, follows a sitemap index into every child, gunzips `.gz` files, and tells you which `<loc>`, `<lastmod>`, `<changefreq>` or `<priority>` entries will be ignored — with a non-zero exit code for CI.

Prefer a browser? The same check runs at [crawlcove.com/tools/xml-sitemap-checker](https://crawlcove.com/tools/xml-sitemap-checker?utm_source=github&utm_medium=xml-sitemap-validator).

## Install

```sh
# one-off, nothing installed (Node 18+):
npx github:CrawlCove/xml-sitemap-validator https://example.com

# global command, from the release tarball:
npm install -g https://github.com/CrawlCove/xml-sitemap-validator/archive/refs/tags/v1.0.0.tar.gz
sitemap-validator --version
```

(The tarball form is deliberate: a global `github:` install on npm 10 leaves a dangling symlink. The npm package is coming.)

## Usage

```sh
sitemap-validator <url> [options]

  <url>                 a sitemap URL, or a site URL — robots.txt "Sitemap:" lines are used, else /sitemap.xml
  --check-urls <n>      also request the first N listed URLs and flag anything that is not HTTP 200 (max 200)
  --max-sitemaps <n>    child sitemaps of an index to validate (default 50)
  --timeout <ms>        per-request timeout (default 15000)
  --json                JSON output
  --fail-on <level>     error (default: exit 1 on any error), warning (exit 1 on anything), none
```

Example:

```
$ sitemap-validator https://example.com
https://example.com/sitemap.xml
  sitemap index, 3 sitemaps, 1 KB
  https://example.com/sitemap-pages.xml
    412 URLs, 88 KB
    ✗ cross-host-loc: https://blog.example.com/post is on a different host than the sitemap (example.com); search engines ignore it unless the sitemap is cross-submitted via robots.txt
    ! duplicate-loc: https://example.com/pricing appears more than once
  https://example.com/sitemap-posts.xml.gz
    1,930 URLs, gzipped, 402 KB
    ✗ invalid-lastmod: lastmod "29/09/2026" is not W3C Datetime (e.g. 2026-09-29 or 2026-09-29T10:00:00+00:00)
  https://example.com/sitemap-images.xml
    0 URLs, 0 KB
    ! empty: <urlset> contains no <url> entries

3 sitemap(s), 2342 URLs, 2 error(s), 2 warning(s).
```

Exit codes: `0` clean (or only warnings with the default `--fail-on error`), `1` a failing finding, `2` usage error.

## What each finding means, and the fix

| Finding | Severity | Why it matters | Fix |
|---|---|---|---|
| `not-found` / `fetch-error` | error | The sitemap URL you submit in Search Console has to return 200. | Check the URL, the server, and any bot-blocking on the host. |
| `not-xml` | error | The response is HTML (an error page, a login wall, a WAF challenge) or malformed XML — usually an unescaped `&` in a URL. | Serve real XML; escape `&` as `&amp;` in every `<loc>`. |
| `wrong-root` | error | Only `<urlset>` and `<sitemapindex>` are sitemaps. RSS/Atom feeds are accepted by Google but are a different format. | Generate a proper sitemap. |
| `missing-namespace` | warning | Without `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` some validators reject the file. | Add the namespace to the root element. |
| `empty` | warning | An empty sitemap is a wasted crawl and often a broken generator. | Fix the generator or remove the sitemap from the index. |
| `too-many-urls` / `too-large` | error | 50,000 URLs and 50 MB (uncompressed) per file are hard limits. | Split into several sitemaps under a sitemap index. |
| `invalid-loc` | error | Every `<loc>` must be an absolute `http(s)` URL. Relative paths and `mailto:` are dropped. | Use full URLs. |
| `cross-host-loc` | error | A sitemap may only list URLs on its own host (`www` and apex count as one). Other hosts are ignored unless robots.txt on that host points at this sitemap. | List those URLs in a sitemap on their own host, or cross-submit via robots.txt. |
| `duplicate-loc` | warning | Harmless but noisy, and often a sign the generator is merging sources twice. | Deduplicate. |
| `invalid-lastmod` | error | `lastmod` must be W3C Datetime (`2026-09-29` or `2026-09-29T10:00:00+00:00`). Anything else is ignored — and Google uses `lastmod` to prioritise re-crawls. | Emit ISO dates. |
| `future-lastmod` | warning | A date in the future looks like a broken clock and undermines trust in every `lastmod` in the file. | Emit the real modification time. |
| `invalid-changefreq` / `invalid-priority` | warning | Must be one of the seven `changefreq` values / a number from 0.0 to 1.0. Google ignores both fields anyway, so wrong values are cost without benefit. | Fix or drop them. |
| `too-many-sitemaps` | warning | An index may hold 50,000 sitemaps; this tool only validates the first `--max-sitemaps` children. | Raise the flag, or split the index. |
| `url-not-ok` (with `--check-urls`) | error | Listed URLs should return 200. Redirecting or 404ing URLs in a sitemap waste crawl budget and get the sitemap marked as low quality. | List final URLs only; remove dead ones. |

## Works with CrawlCove

This validates the sitemap file. [Crawl Cove](https://crawlcove.com/?utm_source=github&utm_medium=xml-sitemap-validator), the desktop SEO crawler for Windows and Mac, compares the sitemap with a crawl of the whole site: pages in the sitemap that are noindex or broken, and pages on the site that the sitemap forgot.

## Related tools

- [crawlcove-js](https://github.com/CrawlCove/seo-crawl-export-js) — `crawlcove-export`, a typed JavaScript/TypeScript library to load, query and convert Crawl Cove exports.
- [crawlcove-sheets](https://github.com/CrawlCove/seo-audit-google-sheets) — Google Sheets add-on that turns a Crawl Cove export into an audit workbook (issues by type, pages by status, title/meta flags).
- [crawlcove-sf-import](https://github.com/CrawlCove/screaming-frog-export-converter) — convert a Screaming Frog export into the Crawl Cove export format, with a report of what carried over.
- [crawlcove-schema-validator](https://github.com/CrawlCove/schema-markup-validator) — validate a page's JSON-LD against Google's required and recommended rich-result properties.
- [crawlcove-hreflang-checker](https://github.com/CrawlCove/hreflang-checker) — check a page's or a sitemap's hreflang tags: codes, self-reference, x-default and return tags.
- [crawlcove-redirect-chain-checker](https://github.com/CrawlCove/redirect-chain-checker) — follow every hop of a URL’s redirects; flags chains, loops, HTTPS downgrades and meta refreshes.
- [crawlcove-cli](https://github.com/CrawlCove/seo-crawler-cli) — headless whole-site crawl with redirect-chain, broken-link, title and noindex checks.
- [crawlcove-action](https://github.com/CrawlCove/seo-audit-action) — the same checks as a GitHub Action on every PR.
- [crawlcove-mcp](https://github.com/CrawlCove/seo-mcp-server) — crawl data for Claude, Cursor and other AI assistants.
- [crawlcove-export-spec](https://github.com/CrawlCove/seo-crawl-export-spec) — the JSON Schema for Crawl Cove's crawl export.
- [crawlcove-robots-txt-tester](https://github.com/CrawlCove/robots-txt-tester) — lint a robots.txt and test which URLs each crawler may fetch, with the deciding line.

## License

MIT — see [LICENSE](LICENSE).
