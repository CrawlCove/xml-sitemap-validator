import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { allFindings, DEFAULT_OPTIONS, discoverSitemaps, totalUrls, validateSitemap, validateXml } from '../src/validate.js'
import { FixtureServer } from './fixtureServer.js'

const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const OPTS = { ...DEFAULT_OPTIONS, now: () => new Date('2026-09-29T00:00:00Z'), timeoutMs: 3000 }
const codes = (r: { findings: Array<{ code: string }> }) => r.findings.map((f) => f.code)

describe('validateXml (pure)', () => {
  it('accepts a correct urlset with every optional field', () => {
    const r = validateXml(
      'https://a.test/sitemap.xml',
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="${NS}"><url><loc>https://a.test/</loc><lastmod>2026-09-01</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url><url><loc><![CDATA[https://a.test/b?x=1&y=2]]></loc><lastmod>2026-09-01T10:00:00+00:00</lastmod></url></urlset>`,
      OPTS
    )
    expect(r.kind).toBe('urlset')
    expect(r.urlCount).toBe(2)
    expect(r.entries[1].loc).toBe('https://a.test/b?x=1&y=2')
    expect(r.findings).toEqual([])
  })

  it('flags each kind of bad entry, once each', () => {
    const r = validateXml(
      'https://a.test/sitemap.xml',
      `<urlset xmlns="${NS}">
        <url><loc>/relative</loc></url>
        <url><loc>https://other.test/page</loc></url>
        <url><loc>https://a.test/dup</loc></url><url><loc>https://a.test/dup</loc></url>
        <url><loc>https://a.test/d</loc><lastmod>29/09/2026</lastmod></url>
        <url><loc>https://a.test/f</loc><lastmod>2030-01-01</lastmod></url>
        <url><loc>https://a.test/c</loc><changefreq>sometimes</changefreq></url>
        <url><loc>https://a.test/p</loc><priority>7</priority></url>
        <url></url>
      </urlset>`,
      OPTS
    )
    expect(codes(r).sort()).toEqual(
      ['cross-host-loc', 'duplicate-loc', 'future-lastmod', 'invalid-changefreq', 'invalid-lastmod', 'invalid-loc', 'invalid-loc', 'invalid-priority'].sort()
    )
    expect(r.findings.find((f) => f.code === 'cross-host-loc')?.loc).toBe('https://other.test/page')
  })

  it('treats www and apex as the same host', () => {
    const r = validateXml('https://www.a.test/sitemap.xml', `<urlset xmlns="${NS}"><url><loc>https://a.test/x</loc></url></urlset>`, OPTS)
    expect(codes(r)).toEqual([])
  })

  it('reports HTML, malformed XML, a wrong root, a missing namespace, and emptiness', () => {
    expect(codes(validateXml('u', '<!doctype html><html><body>login</body></html>', OPTS))).toEqual(['not-xml'])
    expect(validateXml('u', '<!doctype html><html><body>login</body></html>', OPTS).findings[0].message).toMatch(/HTML page/)
    expect(codes(validateXml('u', `<urlset xmlns="${NS}"><url><loc>https://a.test/</loc></urlset>`, OPTS))).toEqual(['not-xml'])
    expect(codes(validateXml('u', '<feed><entry/></feed>', OPTS))).toEqual(['wrong-root'])
    expect(codes(validateXml('https://a.test/s.xml', '<urlset></urlset>', OPTS)).sort()).toEqual(['empty', 'missing-namespace'])
  })

  it('ignores processing instructions such as <?xml-stylesheet?> when finding the root', () => {
    const r = validateXml('https://a.test/sitemap_index.xml', `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="//a.test/main-sitemap.xsl"?>\n<sitemapindex xmlns="${NS}"><sitemap><loc>https://a.test/post-sitemap.xml</loc><lastmod>2026-09-01T09:12:40+00:00</lastmod></sitemap></sitemapindex>`, OPTS)
    expect(r.kind).toBe('sitemapindex')
    expect(r.findings).toEqual([])
    expect(r.urlCount).toBe(1)
  })
  it('enforces the count and size limits (overridden small for the test)', () => {
    const urls = Array.from({ length: 6 }, (_, i) => `<url><loc>https://a.test/${i}</loc></url>`).join('')
    const r = validateXml('https://a.test/s.xml', `<urlset xmlns="${NS}">${urls}</urlset>`, { ...OPTS, maxUrls: 5, maxBytes: 100 })
    expect(codes(r).sort()).toEqual(['too-large', 'too-many-urls'])
  })
})

describe('validateSitemap over HTTP', () => {
  let server: FixtureServer
  afterEach(async () => server.close())

  it('follows a sitemap index into its children, gunzips .gz children, and totals the URLs', async () => {
    const child = (n: number) => `<urlset xmlns="${NS}">${Array.from({ length: n }, (_, i) => `<url><loc>${'URLBASE'}/p${i}</loc></url>`).join('')}</urlset>`
    server = new FixtureServer({})
    const base = await server.listen()
    server.set({
      '/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: `<sitemapindex xmlns="${NS}"><sitemap><loc>${base}/a.xml</loc><lastmod>2026-09-01</lastmod></sitemap><sitemap><loc>${base}/b.xml.gz</loc></sitemap></sitemapindex>` },
      '/a.xml': { headers: { 'content-type': 'application/xml' }, body: child(3).replaceAll('URLBASE', base) },
      '/b.xml.gz': { headers: { 'content-type': 'application/gzip' }, body: gzipSync(child(2).replaceAll('URLBASE', base)) }
    })
    const r = await validateSitemap(`${base}/sitemap.xml`, OPTS)
    expect(r.kind).toBe('sitemapindex')
    expect(r.children).toHaveLength(2)
    expect(r.children[1].gzipped).toBe(true)
    expect(totalUrls(r)).toBe(5)
    expect(allFindings(r)).toEqual([])
  })

  it('follows a redirected sitemap URL and records where it landed', async () => {
    const base = await server.listen()
    server.set({
      '/sitemap.xml': { status: 301, headers: { location: '/sitemap_index.xml' } },
      '/sitemap_index.xml': { headers: { 'content-type': 'application/xml' }, body: `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="/s.xsl"?><sitemapindex xmlns="${NS}"><sitemap><loc>${base}/a.xml</loc></sitemap></sitemapindex>` },
      '/a.xml': { headers: { 'content-type': 'application/xml' }, body: `<urlset xmlns="${NS}"><url><loc>${base}/</loc></url></urlset>` }
    })
    const r = await validateSitemap(`${base}/sitemap.xml`, OPTS)
    expect(r.kind).toBe('sitemapindex')
    expect(r.redirectedTo).toBe(`${base}/sitemap_index.xml`)
    expect(r.children[0]?.redirectedTo).toBeUndefined()
    expect(totalUrls(r)).toBe(1)
  })
  it('reports a 404 sitemap and a child that is missing', async () => {
    server = new FixtureServer({})
    const base = await server.listen()
    const r = await validateSitemap(`${base}/nope.xml`, OPTS)
    expect(codes(r)).toEqual(['not-found'])
  })

  it('--check-urls flags listed URLs that are not 200', async () => {
    server = new FixtureServer({})
    const base = await server.listen()
    server.set({
      '/s.xml': { headers: { 'content-type': 'application/xml' }, body: `<urlset xmlns="${NS}"><url><loc>${base}/ok</loc></url><url><loc>${base}/moved</loc></url><url><loc>${base}/gone</loc></url></urlset>` },
      '/ok': {},
      '/moved': { status: 301, headers: { location: '/ok' } }
    })
    const r = await validateSitemap(`${base}/s.xml`, { ...OPTS, checkUrls: 10 })
    expect(codes(r)).toEqual(['url-not-ok', 'url-not-ok'])
    expect(r.findings[0].message).toMatch(/HTTP 301 \(redirects to \/ok\)/)
    expect(r.findings[1].message).toMatch(/HTTP 404/)
  })
})

describe('discoverSitemaps', () => {
  let server: FixtureServer
  afterEach(async () => server.close())

  it('returns a sitemap URL unchanged, reads robots.txt Sitemap lines for a site URL, and falls back to /sitemap.xml', async () => {
    server = new FixtureServer({ '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nSitemap: https://a.test/one.xml\nsitemap: https://a.test/two.xml\n' } })
    const base = await server.listen()
    expect(await discoverSitemaps(`${base}/my-sitemap.xml`, OPTS)).toEqual([`${base}/my-sitemap.xml`])
    expect(await discoverSitemaps(`${base}/`, OPTS)).toEqual(['https://a.test/one.xml', 'https://a.test/two.xml'])
    await server.close()
    server = new FixtureServer({})
    const base2 = await server.listen()
    expect(await discoverSitemaps(base2, OPTS)).toEqual([`${base2}/sitemap.xml`])
  })
})
