#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { allFindings, DEFAULT_OPTIONS, discoverSitemaps, totalUrls, validateSitemap, type SitemapReport } from './validate.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const program = new Command()
program
  .name('sitemap-validator')
  .description('Validate an XML sitemap or sitemap index against the sitemaps.org protocol and search-engine limits. Give it a sitemap URL, or a site URL to discover the sitemap via robots.txt.')
  .version(version)
  .argument('<url>', 'sitemap URL, or a site URL (robots.txt Sitemap: lines, then /sitemap.xml)')
  .option('--check-urls <n>', 'also request the first N listed URLs and flag anything that is not HTTP 200 (max 200)', '0')
  .option('--max-sitemaps <n>', 'how many child sitemaps of an index to validate', String(DEFAULT_OPTIONS.maxSitemaps))
  .option('--timeout <ms>', 'per-request timeout', String(DEFAULT_OPTIONS.timeoutMs))
  .option('--json', 'JSON output', false)
  .option('--fail-on <level>', '"error" (default) fails only on errors, "warning" fails on anything, "none" never fails', 'error')
  .action(async (url: string, opts) => {
    if (!['error', 'warning', 'none'].includes(opts.failOn)) {
      console.error('--fail-on must be error, warning or none')
      process.exitCode = 2
      return
    }
    const options = {
      ...DEFAULT_OPTIONS,
      checkUrls: Math.min(Number(opts.checkUrls) || 0, 200),
      maxSitemaps: Number(opts.maxSitemaps) || DEFAULT_OPTIONS.maxSitemaps,
      timeoutMs: Number(opts.timeout) || DEFAULT_OPTIONS.timeoutMs
    }
    const targets = await discoverSitemaps(url, options)
    const reports: SitemapReport[] = []
    for (const t of targets) reports.push(await validateSitemap(t, options))

    if (opts.json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)
    else process.stdout.write(reports.map((r) => render(r)).join("\n"))

    const findings = reports.flatMap(allFindings)
    const errors = findings.filter((f) => f.severity === 'error').length
    const warnings = findings.length - errors
    console.error(`\n${reports.length} sitemap(s), ${reports.reduce((n, r) => n + totalUrls(r), 0)} URLs, ${errors} error(s), ${warnings} warning(s).`)
    if ((opts.failOn === 'error' && errors > 0) || (opts.failOn === 'warning' && findings.length > 0)) process.exitCode = 1
  })

export function render(r: SitemapReport, indent = ''): string {
  const lines = [`${indent}${r.url}${r.redirectedTo ? `  (redirected to ${r.redirectedTo})` : ''}`]
  const what = r.kind === 'sitemapindex' ? `sitemap index, ${r.urlCount} sitemaps` : r.kind === 'urlset' ? `${r.urlCount} URLs` : 'unrecognised'
  lines.push(`${indent}  ${what}${r.gzipped ? ', gzipped' : ''}, ${(r.bytes / 1024).toFixed(0)} KB`)
  for (const f of r.findings) lines.push(`${indent}  ${f.severity === 'error' ? '✗' : '!'} ${f.code}: ${f.message}`)
  if (r.findings.length === 0) lines.push(`${indent}  ✓ no findings`)
  for (const c of r.children) lines.push(render(c, indent + '  '))
  return lines.join('\n') + (indent ? '' : '\n')
}

program.parseAsync(process.argv)
