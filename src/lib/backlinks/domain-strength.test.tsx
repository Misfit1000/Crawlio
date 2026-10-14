import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import { build } from 'esbuild';
import DomainStrengthCard from '../../components/backlinks/DomainStrengthCard';
import { makeAuditScope } from '../audit/audit-scope';
import { extractReportScores } from '../audit/report-insights';
import { calculateDomainStrength } from './domain-strength';
import { parseOpenPageRankResponse, parseTrancoEvidence } from './provider-evidence';
import { createDomainEvidenceService } from './public-link-signals';

const auditScores = { seo: 76, technical: 84, crawlability: 80, internalLinks: 72, performance: 68, structuredData: 60 };
const scores = extractReportScores(auditScores);

async function signals(score = 0, host = false) {
  const domain = host ? 'tenant.github.io' : 'example.com';
  const providerRow = { domain, host: domain, found: true, open_page_rank: score, referring_domains: 0, referring_hosts: 0,
    history: [{ date: '2026-09-01', open_page_rank: score, estimated: true }, { date: '2026-10-01', open_page_rank: score, estimated: false }] };
  const get = createDomainEvidenceService({
    apiKey: () => 'fixture-key', store: { async read() { return null; }, async write() {} },
    openPageRank: async () => parseOpenPageRankResponse({ as_of: '2026-10-01', results: [host ? { domain: 'github.io', hosts: [providerRow] } : providerRow] }, domain),
    tranco: async () => parseTrancoEvidence({ domain, ranks: [] }, domain),
  });
  return get(domain);
}

test('site score, grade, confidence and factor coverage are invariant to external metrics and errors', async () => {
  const auditOnly = calculateDomainStrength(scores);
  assert.equal(auditOnly.score, 77);
  assert.equal(auditOnly.coverage, 100);
  assert.equal(auditOnly.confidence, 'standard');
  for (const external of [await signals(0), await signals(10)]) {
    assert.deepEqual(calculateDomainStrength(scores, external), auditOnly);
    const legacy = { ...external, globalRank: 1, referringSubnets: 999_999, referringIps: 999_999,
      linkStatus: 'measured' as const, webRankStatus: 'measured' as const, webRank: 1 };
    const withLegacy = calculateDomainStrength(scores, legacy);
    assert.equal(withLegacy.score, auditOnly.score);
    assert.equal(withLegacy.grade, auditOnly.grade);
    assert.equal(withLegacy.confidence, auditOnly.confidence);
    assert.equal(withLegacy.coverage, auditOnly.coverage);
    assert.equal(withLegacy.linkVisibility, 100, 'legacy external derived fields remain separate');
  }
});

test('page and focused scopes cannot produce a website-wide strength score', () => {
  for (const auditScope of [makeAuditScope('full', 'page'), makeAuditScope('technical', 'site'), makeAuditScope('security')]) {
    const result = calculateDomainStrength(scores, null, { auditScope });
    assert.equal(result.score, null);
    assert.equal(result.siteStrength, null);
    assert.equal(result.grade, null);
    assert.equal(result.confidence, 'limited');
    assert.equal(result.eligibleForSiteStrength, false);
  }
  const technical = calculateDomainStrength(scores, null, { auditScope: makeAuditScope('technical', 'site') });
  assert.deepEqual(technical.factors.filter(item => item.score !== null).map(item => item.id), ['technical']);
});

test('only explicitly measured factors contribute, including valid zeroes', () => {
  const result = calculateDomainStrength(scores, null, { evidenceSummary: { measuredFactors: ['technical', 'seo'] } });
  assert.equal(result.score, null);
  assert.equal(result.coverage, 40);
  const zero = calculateDomainStrength(extractReportScores({ technical: 0, seo: 0, crawlability: 0 }));
  assert.equal(zero.score, 0);
  assert.equal(zero.grade, 'F');
  assert.equal(zero.coverage, 65);
  assert.equal(zero.confidence, 'limited');
  assert.equal(calculateDomainStrength(scores, null, { evidenceSummary: { analysedPages: 0 } }).score, null);
  assert.equal(calculateDomainStrength(scores, null, { evidenceSummary: { sampled: true } }).confidence, 'limited');
});

test('card leads with Site Strength, renders zero external scores, and labels estimated history', async () => {
  const externalEvidence = await signals(0);
  const markup = renderToStaticMarkup(<DomainStrengthCard domain="example.com" auditScores={auditScores} externalEvidence={externalEvidence}
    evidenceSummary={{ analysedPages: 5, discoveredPages: 100, sampled: true }} />);
  const $ = load(markup);
  assert.equal($('h2').text(), 'Crawlio Site Strength');
  assert.match($.text(), /77\/100/);
  assert.match($.text(), /Open PageRank0\/10/);
  assert.match($.text(), /Referring domains0/);
  assert.match($.text(), /5 pages analysed of 100 discovered \(sampled evidence\)/);
  assert.match($.text(), /2026-10-01/);
  assert.match($('table').text(), /Estimated/);
  assert.match($('table').text(), /Measured/);
  assert.doesNotMatch($.text(), /Checking optional external evidence|Crawlio Domain Strength/);
});

test('card distinguishes host counts, absent/not-configured/stale evidence, and page scope', async () => {
  const externalEvidence = await signals(0, true);
  const hostText = load(renderToStaticMarkup(<DomainStrengthCard domain="tenant.github.io" auditScores={auditScores} externalEvidence={externalEvidence} />)).text();
  assert.match(hostText, /Referring hosts0/);
  assert.match(hostText, /authority-filtered hosts, not domains/);
  assert.match(hostText, /exact host scope/);
  for (const status of ['not_listed', 'not_configured', 'stale', 'unavailable'] as const) {
    const evidence = { ...externalEvidence, openPageRank: { ...externalEvidence.openPageRank!, status, score: status === 'stale' ? 0 : null },
      sources: { ...externalEvidence.sources!, openPageRank: { ...externalEvidence.sources!.openPageRank, status } } };
    const text = load(renderToStaticMarkup(<DomainStrengthCard domain="tenant.github.io" auditScores={auditScores} externalEvidence={evidence} />)).text();
    assert.match(text, new RegExp({ not_listed: 'Not listed in this source', not_configured: 'Not configured', stale: 'Stale cached evidence', unavailable: 'Unavailable' }[status]));
    assert.match(text, /77\/100/);
  }
  const pageText = load(renderToStaticMarkup(<DomainStrengthCard domain="example.com" auditScores={auditScores} auditScope={makeAuditScope('full', 'page')} externalEvidence={null} />)).text();
  assert.match(pageText, /Page-only audit/);
  assert.doesNotMatch(pageText, /77\/100/);
});

test('browser card dependency graph contains no provider, Supabase server or API key code', async () => {
  const result = await build({ entryPoints: ['src/components/backlinks/DomainStrengthCard.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
  const files = Object.keys(result.metafile!.inputs).join('\n');
  assert.doesNotMatch(files, /public-link-signals|provider-evidence|provider-http|open-page-rank|domain-evidence-cache|supabase\/server/);
  assert.doesNotMatch(result.outputFiles[0].text, /OPEN_PAGE_RANK_API_KEY|SUPABASE_SERVICE_ROLE_KEY|Bearer fixture/);
});
