<a href="https://crawlcove.com/download?utm_source=github&utm_medium=readme&utm_campaign=xml-sitemap-validator"><img src="https://raw.githubusercontent.com/CrawlCove/.github/main/banners/xml-sitemap-validator.svg" width="1200" alt="xml-sitemap-validator: Check a sitemap or sitemap index against the sitemaps.org protocol and search engine limits. Flags bad URLs, lastmod dates and cross-host entries." /></a>

# xml-sitemap-validator

An **XML sitemap validator** CLI: point it at a sitemap (or just your site) and it checks the XML against the sitemaps.org protocol and the limits search engines enforce, follows a sitemap index into every child, gunzips `.gz` files, and tells you which `<loc>`, `<lastmod>`, `<changefreq>` or `<priority>` entries will be ignored. Non-zero exit code for CI.

Prefer a browser? The same check runs at [crawlcove.com/tools/xml-sitemap-checker](https://crawlcove.com/tools/xml-sitemap-checker?utm_source=github&utm_medium=xml-sitemap-validator).

<img src="docs/demo.svg" width="980" alt="Terminal recording: validating the SEO test site sitemap finds 53 URLs and one that returns 404">

*Recorded from a real run against [seo-test-site](https://github.com/CrawlCove/seo-test-site), a public site full of planted SEO problems that you can test against too.*

## Quick start

```sh
npx github:CrawlCove/xml-sitemap-validator https://crawlcove.github.io/seo-test-site/sitemap.xml --check-urls 60
```

```
https://crawlcove.github.io/seo-test-site/sitemap.xml
  53 URLs, 6 KB
  ✗ url-not-ok: https://crawlcove.github.io/seo-test-site/products/sold-out.html returns HTTP 404

1 sitemap(s), 53 URLs, 1 error(s), 0 warning(s).
```

## Install

```sh
# one-off, nothing installed (Node 18+):
npx github:CrawlCove/xml-sitemap-validator https://example.com

# global command, from the release tarball:
npm install -g https://github.com/CrawlCove/xml-sitemap-validator/archive/refs/tags/v1.0.1.tar.gz
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
| `not-xml` | error | The response is HTML (an error page, a login wall, a WAF challenge) or malformed XML, usually because of an unescaped `&` in a URL. | Serve real XML; escape `&` as `&amp;` in every `<loc>`. |
| `wrong-root` | error | Only `<urlset>` and `<sitemapindex>` are sitemaps. RSS/Atom feeds are accepted by Google but are a different format. | Generate a proper sitemap. |
| `missing-namespace` | warning | Without `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` some validators reject the file. | Add the namespace to the root element. |
| `empty` | warning | An empty sitemap is a wasted crawl and often a broken generator. | Fix the generator or remove the sitemap from the index. |
| `too-many-urls` / `too-large` | error | 50,000 URLs and 50 MB (uncompressed) per file are hard limits. | Split into several sitemaps under a sitemap index. |
| `invalid-loc` | error | Every `<loc>` must be an absolute `http(s)` URL. Relative paths and `mailto:` are dropped. | Use full URLs. |
| `cross-host-loc` | error | A sitemap may only list URLs on its own host (`www` and apex count as one). Other hosts are ignored unless robots.txt on that host points at this sitemap. | List those URLs in a sitemap on their own host, or cross-submit via robots.txt. |
| `duplicate-loc` | warning | Harmless but noisy, and often a sign the generator is merging sources twice. | Deduplicate. |
| `invalid-lastmod` | error | `lastmod` must be W3C Datetime (`2026-09-29` or `2026-09-29T10:00:00+00:00`). Anything else is ignored, and Google uses `lastmod` to prioritise re-crawls. | Emit ISO dates. |
| `future-lastmod` | warning | A date in the future looks like a broken clock and undermines trust in every `lastmod` in the file. | Emit the real modification time. |
| `invalid-changefreq` / `invalid-priority` | warning | Must be one of the seven `changefreq` values / a number from 0.0 to 1.0. Google ignores both fields anyway, so wrong values are cost without benefit. | Fix or drop them. |
| `too-many-sitemaps` | warning | An index may hold 50,000 sitemaps; this tool only validates the first `--max-sitemaps` children. | Raise the flag, or split the index. |
| `url-not-ok` (with `--check-urls`) | error | Listed URLs should return 200. Redirecting or 404ing URLs in a sitemap waste crawl budget and get the sitemap marked as low quality. | List final URLs only; remove dead ones. |

## Works with CrawlCove

This validates the sitemap file. [Crawl Cove](https://crawlcove.com/?utm_source=github&utm_medium=xml-sitemap-validator), the desktop SEO crawler, compares the sitemap with a crawl of the whole site: pages in the sitemap that are noindex or broken, and pages on the site that the sitemap forgot.

## Related tools

<!-- related:start, kept in step by CrawlCove/.github scripts/related.mjs -->
| Repo | What it does |
|---|---|
| [seo-crawler-cli](https://github.com/CrawlCove/seo-crawler-cli) | Crawl a site from a script or CI. Checks status codes, redirect chains, titles, meta descriptions, H1s, canonicals, noindex and broken links, and fails the build on regressions. |
| [seo-audit-action](https://github.com/CrawlCove/seo-audit-action) | Crawl a staging or preview URL on every pull request. Fails the check on broken links, missing titles, noindex and redirect chains, with the details as a PR comment. |
| [seo-mcp-server](https://github.com/CrawlCove/seo-mcp-server) | Crawl a site, list SEO issues, inspect pages and find broken links from inside Claude, Cursor and other AI assistants. |
| [claude-seo-plugin](https://github.com/CrawlCove/claude-seo-plugin) | Seven SEO skills for Claude Code backed by a real site crawl: audits, broken links, redirects, titles and fixes, from a chat. |
| [seo-chrome-extension](https://github.com/CrawlCove/seo-chrome-extension) | On-page SEO checker with an AI visibility report: which AI crawlers can read the page, snippet blocks, llms.txt and extractability. Nothing leaves the browser. |
| [robots-txt-tester](https://github.com/CrawlCove/robots-txt-tester) | Fetch and lint a robots.txt, test which URLs each crawler may fetch and see the deciding line. Fails deploys that block the site. |
| [redirect-chain-checker](https://github.com/CrawlCove/redirect-chain-checker) | Follow every hop of a URL's redirects and flag chains, loops, HTTPS downgrades, meta refreshes and redirects to error pages. |
| [hreflang-checker](https://github.com/CrawlCove/hreflang-checker) | Validate the hreflang tags on a page or across a whole XML sitemap, including self-reference, x-default and return tags. |
| [schema-markup-validator](https://github.com/CrawlCove/schema-markup-validator) | Check every schema.org node on a page against the required and recommended properties for rich results. |
| [seo-test-site](https://github.com/CrawlCove/seo-test-site) | A deliberately broken SEO test site with every planted problem and its expected finding listed, for testing any SEO crawler. |
| [seo-crawl-export-spec](https://github.com/CrawlCove/seo-crawl-export-spec) | An open format for site crawl data: JSON Schema and CSV column reference, with a real sample export and a validator script. |
| [seo-crawl-export-js](https://github.com/CrawlCove/seo-crawl-export-js) | Load, query and convert site crawl data in JavaScript and TypeScript, with typed pages, issues by type and status filters. |
| [screaming-frog-export-converter](https://github.com/CrawlCove/screaming-frog-export-converter) | Turn an SEO Spider internal_all.csv into the open JSON crawl export format, with a report of which columns carried over. |
| [seo-audit-google-sheets](https://github.com/CrawlCove/seo-audit-google-sheets) | An Apps Script add-on that turns a site crawl export into an audit workbook: pages, issues by type, pages by status and title and meta flags. |
| [wordpress-seo-connector](https://github.com/CrawlCove/wordpress-seo-connector) | Bulk-apply fixes from the Crawl Cove desktop crawler to Yoast SEO, Rank Math, SEOPress or AIOSEO, with a change log and one-click revert. |
<!-- related:end -->

## License

MIT, see [LICENSE](LICENSE).
