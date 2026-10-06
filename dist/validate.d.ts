export type Severity = 'error' | 'warning';
export type FindingCode = 'fetch-error' | 'not-found' | 'not-xml' | 'wrong-root' | 'missing-namespace' | 'empty' | 'too-many-urls' | 'too-large' | 'invalid-loc' | 'cross-host-loc' | 'duplicate-loc' | 'invalid-lastmod' | 'future-lastmod' | 'invalid-changefreq' | 'invalid-priority' | 'too-many-sitemaps' | 'url-not-ok';
export interface Finding {
    code: FindingCode;
    severity: Severity;
    message: string;
    /** The <loc> the finding is about, when there is one. */
    loc?: string;
}
export interface SitemapEntry {
    loc: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
}
export interface SitemapReport {
    url: string;
    /** Set when `url` redirected; the sitemap that was actually validated. */
    redirectedTo?: string;
    kind: 'urlset' | 'sitemapindex' | 'unknown';
    urlCount: number;
    bytes: number;
    gzipped: boolean;
    entries: SitemapEntry[];
    findings: Finding[];
    /** Reports for the child sitemaps of an index. */
    children: SitemapReport[];
}
export interface ValidateOptions {
    /** sitemaps.org limits, overridable for tests. */
    maxUrls: number;
    maxBytes: number;
    /** How many child sitemaps of an index to fetch and validate. */
    maxSitemaps: number;
    timeoutMs: number;
    userAgent: string;
    /** Optionally request the first N <loc> URLs and flag non-2xx responses. 0 = off. */
    checkUrls: number;
    now: () => Date;
    fetch?: typeof fetch;
}
export declare const DEFAULT_OPTIONS: ValidateOptions;
export declare const SEVERITY: Record<FindingCode, Severity>;
export interface Fetched {
    status: number | null;
    /** The URL that actually answered, after redirects (null when nothing answered). */
    finalUrl: string | null;
    body: Buffer | null;
    contentType: string | null;
    fetchError: string | null;
}
export declare function fetchSitemapText(url: string, opts: ValidateOptions): Promise<Fetched>;
/** Gunzip when the bytes are gzip, regardless of file extension or headers. */
export declare function decodeBody(body: Buffer): {
    text: string;
    gzipped: boolean;
};
/** Validate sitemap XML text that has already been fetched. Pure. */
export declare function validateXml(url: string, text: string, opts?: ValidateOptions): Omit<SitemapReport, 'children' | 'gzipped'>;
/** Fetch and validate `url`; for a sitemap index, also fetch and validate up to `maxSitemaps` children. */
export declare function validateSitemap(url: string, opts?: ValidateOptions, depth?: number): Promise<SitemapReport>;
/** Every finding in a report tree, with the sitemap URL each came from. */
export declare function allFindings(report: SitemapReport): Array<Finding & {
    sitemap: string;
}>;
/** Total <url> entries across an index tree (children only for an index). */
export declare function totalUrls(report: SitemapReport): number;
/**
 * Turn a bare site URL into candidate sitemap URLs: robots.txt `Sitemap:` lines first, then /sitemap.xml.
 * Returns the input unchanged when it already looks like a sitemap file.
 */
export declare function discoverSitemaps(input: string, opts?: ValidateOptions): Promise<string[]>;
