/**
 * Fetch + parse + validate an XML sitemap (or sitemap index, recursively).
 * Network in `fetchSitemapText`; everything else pure and unit-testable.
 */
import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
export const DEFAULT_OPTIONS = {
    maxUrls: 50_000,
    maxBytes: 50 * 1024 * 1024,
    maxSitemaps: 50,
    timeoutMs: 15_000,
    userAgent: 'crawlcove-sitemap-validator/1.0 (+https://github.com/CrawlCove/crawlcove-sitemap-validator)',
    checkUrls: 0,
    now: () => new Date()
};
export const SEVERITY = {
    'fetch-error': 'error',
    'not-found': 'error',
    'not-xml': 'error',
    'wrong-root': 'error',
    'missing-namespace': 'warning',
    empty: 'warning',
    'too-many-urls': 'error',
    'too-large': 'error',
    'invalid-loc': 'error',
    'cross-host-loc': 'error',
    'duplicate-loc': 'warning',
    'invalid-lastmod': 'error',
    'future-lastmod': 'warning',
    'invalid-changefreq': 'warning',
    'invalid-priority': 'warning',
    'too-many-sitemaps': 'warning',
    'url-not-ok': 'error'
};
const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const CHANGEFREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
// W3C Datetime as the protocol allows: YYYY, YYYY-MM, YYYY-MM-DD, or full date-time with timezone.
const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
function finding(code, message, loc) {
    return { code, severity: SEVERITY[code], message, ...(loc ? { loc } : {}) };
}
export async function fetchSitemapText(url, opts) {
    const doFetch = opts.fetch ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
        const res = await doFetch(url, { headers: { 'user-agent': opts.userAgent, accept: 'application/xml,text/xml,*/*' }, signal: controller.signal, redirect: 'follow' });
        const body = Buffer.from(await res.arrayBuffer());
        return { status: res.status, finalUrl: res.url || url, body, contentType: res.headers.get('content-type'), fetchError: null };
    }
    catch (err) {
        const name = err instanceof Error ? err.name : String(err);
        return { status: null, finalUrl: null, body: null, contentType: null, fetchError: name === 'AbortError' ? 'TIMEOUT' : err.message || name };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Gunzip when the bytes are gzip, regardless of file extension or headers. */
export function decodeBody(body) {
    if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b)
        return { text: gunzipSync(body).toString('utf8'), gzipped: true };
    return { text: body.toString('utf8'), gzipped: false };
}
/* ---------- parsing + validation (pure) ---------- */
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
    cdataPropName: false,
    isArray: (name) => name === 'url' || name === 'sitemap'
});
function textOf(v) {
    if (v === undefined || v === null)
        return undefined;
    if (typeof v === 'string')
        return v;
    if (typeof v === 'object' && '#text' in v)
        return String(v['#text']);
    return String(v);
}
/** Validate sitemap XML text that has already been fetched. Pure. */
export function validateXml(url, text, opts = DEFAULT_OPTIONS) {
    const findings = [];
    const bytes = Buffer.byteLength(text, 'utf8');
    const base = { url, urlCount: 0, bytes, entries: [], findings };
    if (bytes > opts.maxBytes)
        findings.push(finding('too-large', `${(bytes / 1024 / 1024).toFixed(1)} MB uncompressed; the limit is ${opts.maxBytes / 1024 / 1024} MB per sitemap`));
    const wellFormed = XMLValidator.validate(text);
    if (wellFormed !== true) {
        const looksHtml = /^\s*(<!doctype html|<html)/i.test(text);
        findings.push(finding('not-xml', looksHtml ? 'the response is an HTML page, not XML (a 200 error page or a login wall?)' : `not well-formed XML: ${wellFormed.err.msg} (line ${wellFormed.err.line})`));
        return { ...base, kind: 'unknown' };
    }
    let doc;
    try {
        doc = parser.parse(text);
    }
    catch (err) {
        findings.push(finding('not-xml', `could not parse XML: ${err.message}`));
        return { ...base, kind: 'unknown' };
    }
    // fast-xml-parser surfaces every processing instruction as a top-level
    // key starting with "?" (the <?xml ...?> prolog, and the <?xml-stylesheet ...?>
    // line that Yoast, Rank Math and most WordPress sitemaps emit so the XML
    // renders as a styled page in a browser). None of those is the root element.
    const rootName = Object.keys(doc).find((k) => !k.startsWith('?') && !k.startsWith('#'));
    if (rootName !== 'urlset' && rootName !== 'sitemapindex') {
        findings.push(finding('wrong-root', `root element is <${rootName ?? 'nothing'}>; expected <urlset> or <sitemapindex>`));
        return { ...base, kind: 'unknown' };
    }
    const root = (doc[rootName] ?? {});
    if (root['@_xmlns'] !== SITEMAP_NS)
        findings.push(finding('missing-namespace', `xmlns is ${root['@_xmlns'] ? `"${root['@_xmlns']}"` : 'missing'}; expected "${SITEMAP_NS}"`));
    const itemName = rootName === 'urlset' ? 'url' : 'sitemap';
    const items = root[itemName] ?? [];
    if (items.length === 0)
        findings.push(finding('empty', `<${rootName}> contains no <${itemName}> entries`));
    if (rootName === 'urlset' && items.length > opts.maxUrls)
        findings.push(finding('too-many-urls', `${items.length} URLs; the limit is ${opts.maxUrls} per sitemap — split it and use a sitemap index`));
    if (rootName === 'sitemapindex' && items.length > opts.maxUrls)
        findings.push(finding('too-many-sitemaps', `${items.length} child sitemaps; the limit is ${opts.maxUrls} per index`));
    const sitemapHost = safeUrl(url);
    const seen = new Set();
    const now = opts.now();
    const entries = [];
    for (const item of items) {
        const loc = textOf(item.loc);
        const entry = { loc: loc ?? '' };
        const lastmod = textOf(item.lastmod);
        const changefreq = textOf(item.changefreq);
        const priority = textOf(item.priority);
        if (lastmod !== undefined)
            entry.lastmod = lastmod;
        if (changefreq !== undefined)
            entry.changefreq = changefreq;
        if (priority !== undefined)
            entry.priority = priority;
        entries.push(entry);
        if (!loc) {
            findings.push(finding('invalid-loc', `<${itemName}> without a <loc>`));
            continue;
        }
        const parsed = safeUrl(loc);
        if (!parsed || !/^https?:$/.test(parsed.protocol)) {
            findings.push(finding('invalid-loc', `"${loc}" is not an absolute http(s) URL`, loc));
            continue;
        }
        if (sitemapHost && parsed.host.replace(/^www\./, '') !== sitemapHost.host.replace(/^www\./, '')) {
            findings.push(finding('cross-host-loc', `${loc} is on a different host than the sitemap (${sitemapHost.host}); search engines ignore it unless the sitemap is cross-submitted via robots.txt`, loc));
        }
        if (seen.has(loc))
            findings.push(finding('duplicate-loc', `${loc} appears more than once`, loc));
        seen.add(loc);
        if (lastmod !== undefined) {
            if (!W3C_DATETIME.test(lastmod))
                findings.push(finding('invalid-lastmod', `lastmod "${lastmod}" is not W3C Datetime (e.g. 2026-09-29 or 2026-09-29T10:00:00+00:00)`, loc));
            else if (new Date(lastmod).getTime() > now.getTime() + 24 * 3600 * 1000)
                findings.push(finding('future-lastmod', `lastmod ${lastmod} is in the future`, loc));
        }
        if (changefreq !== undefined && !CHANGEFREQ.has(changefreq))
            findings.push(finding('invalid-changefreq', `changefreq "${changefreq}" is not one of ${[...CHANGEFREQ].join('/')}`, loc));
        if (priority !== undefined) {
            const n = Number(priority);
            if (!/^\d?(\.\d+)?$/.test(priority) || Number.isNaN(n) || n < 0 || n > 1)
                findings.push(finding('invalid-priority', `priority "${priority}" must be a number from 0.0 to 1.0`, loc));
        }
    }
    return { ...base, kind: rootName, urlCount: items.length, entries };
}
function safeUrl(u) {
    try {
        return new URL(u);
    }
    catch {
        return null;
    }
}
/* ---------- orchestration ---------- */
/** Fetch and validate `url`; for a sitemap index, also fetch and validate up to `maxSitemaps` children. */
export async function validateSitemap(url, opts = DEFAULT_OPTIONS, depth = 0) {
    const fetched = await fetchSitemapText(url, opts);
    const empty = { url, kind: 'unknown', urlCount: 0, bytes: 0, gzipped: false, entries: [], findings: [], children: [] };
    if (fetched.fetchError !== null || fetched.body === null)
        return { ...empty, findings: [finding('fetch-error', `${url} could not be fetched: ${fetched.fetchError}`)] };
    if (fetched.status === 404 || fetched.status === 410)
        return { ...empty, findings: [finding('not-found', `${url} returned HTTP ${fetched.status}`)] };
    if (fetched.status !== null && fetched.status >= 400)
        return { ...empty, findings: [finding('fetch-error', `${url} returned HTTP ${fetched.status}`)] };
    let decoded;
    try {
        decoded = decodeBody(fetched.body);
    }
    catch (err) {
        return { ...empty, bytes: fetched.body.length, findings: [finding('not-xml', `gzip data could not be decompressed: ${err.message}`)] };
    }
    const report = { ...validateXml(url, decoded.text, opts), gzipped: decoded.gzipped, children: [] };
    if (fetched.finalUrl !== null && fetched.finalUrl !== url)
        report.redirectedTo = fetched.finalUrl;
    if (report.kind === 'sitemapindex' && depth === 0) {
        const childLocs = report.entries.map((e) => e.loc).filter((l) => safeUrl(l) !== null);
        if (childLocs.length > opts.maxSitemaps)
            report.findings.push(finding('too-many-sitemaps', `index lists ${childLocs.length} sitemaps; only the first ${opts.maxSitemaps} were validated (raise --max-sitemaps)`));
        for (const loc of childLocs.slice(0, opts.maxSitemaps))
            report.children.push(await validateSitemap(loc, opts, depth + 1));
    }
    if (opts.checkUrls > 0 && report.kind === 'urlset') {
        const doFetch = opts.fetch ?? fetch;
        for (const e of report.entries.slice(0, opts.checkUrls)) {
            if (!safeUrl(e.loc))
                continue;
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
                let res;
                try {
                    res = await doFetch(e.loc, { method: 'HEAD', headers: { 'user-agent': opts.userAgent }, signal: controller.signal, redirect: 'manual' });
                }
                finally {
                    clearTimeout(timer);
                }
                if (res.status !== 200)
                    report.findings.push(finding('url-not-ok', `${e.loc} returns HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ` (redirects to ${res.headers.get('location')}) — list the final URL instead` : ''}`, e.loc));
            }
            catch (err) {
                report.findings.push(finding('url-not-ok', `${e.loc} could not be fetched: ${err.message}`, e.loc));
            }
        }
    }
    return report;
}
/** Every finding in a report tree, with the sitemap URL each came from. */
export function allFindings(report) {
    return [...report.findings.map((f) => ({ ...f, sitemap: report.url })), ...report.children.flatMap(allFindings)];
}
/** Total <url> entries across an index tree (children only for an index). */
export function totalUrls(report) {
    return report.kind === 'sitemapindex' ? report.children.reduce((n, c) => n + totalUrls(c), 0) : report.urlCount;
}
/**
 * Turn a bare site URL into candidate sitemap URLs: robots.txt `Sitemap:` lines first, then /sitemap.xml.
 * Returns the input unchanged when it already looks like a sitemap file.
 */
export async function discoverSitemaps(input, opts = DEFAULT_OPTIONS) {
    const u = safeUrl(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!u)
        return [input];
    if (/\.(xml|gz|txt)$/i.test(u.pathname) || u.pathname.includes('sitemap'))
        return [u.toString()];
    const robots = await fetchSitemapText(`${u.origin}/robots.txt`, opts);
    const fromRobots = [];
    if (robots.status === 200 && robots.body) {
        for (const line of robots.body.toString('utf8').split(/\r?\n/)) {
            const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
            if (m)
                fromRobots.push(m[1]);
        }
    }
    return fromRobots.length > 0 ? [...new Set(fromRobots)] : [`${u.origin}/sitemap.xml`];
}
