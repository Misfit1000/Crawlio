import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractReportScores } from '../src/lib/audit/report-insights';
import { calculateDomainStrength, rankToScore } from '../src/lib/backlinks/domain-strength';
import type { PublicLinkSignals } from '../src/lib/backlinks/types';

const auditScores = extractReportScores({
  seo: 76,
  technical: 84,
  crawlability: 80,
  internalLinks: 72,
  performance: 68,
  structuredData: 60,
});

const auditOnly = calculateDomainStrength(auditScores, null);
assert.equal(auditOnly.score, 77);
assert.equal(auditOnly.confidence, 'standard');
assert.equal(auditOnly.coverage, 100);
assert.equal(auditOnly.linkVisibility, null);
assert.equal(auditOnly.webPopularity, null);
assert.equal(auditOnly.factors.length, 6);
assert.equal(auditOnly.recommendations[0], 'Add valid structured data and complete social preview metadata.');

const baseSignals: PublicLinkSignals = {
  domain: 'github.com', found: true, globalRank: 10, tldRank: 10, referringSubnets: 256_487, referringIps: 648_351,
  datasetDate: '16 Jul 2026', fetchedAt: '2026-07-16T00:00:00.000Z', source: 'Majestic Million',
  sourceUrl: 'https://majestic.com/reports/majestic-million', license: 'CC BY 3.0', scope: 'public_top_million',
  linkStatus: 'measured', webRankStatus: 'measured', webRank: 31, previousWebRank: 40, webRankChange: 9,
  webRankHistory: [{ date: '2026-07-16', rank: 31 }, { date: '2026-06-16', rank: 40 }], partial: false,
  attributions: [{ label: 'Majestic Million', url: 'https://majestic.com/reports/majestic-million', license: 'CC BY 3.0' }, { label: 'Tranco', url: 'https://tranco-list.eu/' }],
};
const full = calculateDomainStrength(auditScores, baseSignals);
assert.equal(full.confidence, 'standard');
assert.equal(full.coverage, 100);
assert.equal(full.score, auditOnly.score, 'external authority must never alter site strength');
assert.ok(full.linkVisibility != null);
assert.equal(full.webPopularity, rankToScore(31));

const unranked: PublicLinkSignals = {
  ...baseSignals,
  domain: 'taxcare.com.np', found: false, globalRank: null, tldRank: null, referringSubnets: null, referringIps: null,
  linkStatus: 'not_ranked', webRankStatus: 'not_ranked', webRank: null, previousWebRank: null, webRankChange: null, webRankHistory: [],
};
const unrankedResult = calculateDomainStrength(auditScores, unranked);
assert.equal(unrankedResult.score, auditOnly.score, 'an unranked domain must retain its measured audit-based score');
assert.equal(unrankedResult.confidence, 'standard');
assert.equal(unrankedResult.coverage, 100);

const partial = calculateDomainStrength(auditScores, { ...baseSignals, webRankStatus: 'unavailable', webRank: null, previousWebRank: null, webRankChange: null, webRankHistory: [], partial: true });
assert.equal(partial.confidence, 'standard');
assert.equal(partial.coverage, 100);
assert.ok(partial.linkVisibility != null);
assert.equal(partial.webPopularity, null);

const insufficient = calculateDomainStrength(extractReportScores({ technical: 90, crawlability: 80 }), null);
assert.equal(insufficient.score, null);
assert.equal(insufficient.grade, null);

const component = await readFile('src/components/backlinks/DomainStrengthCard.tsx', 'utf8');
assert.doesNotMatch(component, /Public backlink signals|Outside top million|is not present in the public top million/);
assert.match(component, /Crawlio Site Strength/);
assert.match(component, /auditScope\?: AuditScope/);
assert.match(component, /External domain evidence/);
assert.match(component, /opr\.score\}\/10/);
assert.match(component, /Rank not measured|Not measured/);
assert.match(component, /Limited confidence/);
assert.match(component, /Standard confidence/);

console.log('Domain strength scoring smoke test passed.');
