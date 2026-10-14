import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMajesticMillionPage, parseTrancoRankResponse } from '../src/lib/backlinks/public-link-signals';

const fixture = `
  <html><body>
    <h1>The Majestic Million</h1>
    <table>
      <thead><tr><th>Position</th><th>Change</th><th>Domain</th><th>TLD</th><th>TLD Rank</th><th>Referring Subnets</th><th>Referring IPs</th></tr></thead>
      <tbody><tr>
        <td>10</td><td>1</td><td><a class="domainname">github.com</a></td><td>.com</td><td>10</td><td>256,487 433</td><td>648,351 111</td>
      </tr></tbody>
    </table>
    <div>Top Million Root Domains List generated on 16 Jul 2026 using data from the Fresh Index</div>
  </body></html>`;

const found = parseMajesticMillionPage(fixture, 'www.github.com', '2026-07-16T00:00:00.000Z');
assert.equal(found.found, true);
assert.equal(found.domain, 'github.com');
assert.equal(found.globalRank, 10);
assert.equal(found.tldRank, 10);
assert.equal(found.referringSubnets, 256_487);
assert.equal(found.referringIps, 648_351);
assert.equal(found.datasetDate, '16 Jul 2026');
assert.equal(found.license, 'CC BY 3.0');

const absent = parseMajesticMillionPage('<html><body><h1>The Majestic Million</h1><p>Unfortunately taxcare.com.np is not in the Majestic Million.</p><div>Top Million Root Domains List generated on 16 Jul 2026 using data from the Fresh Index</div></body></html>', 'taxcare.com.np');
assert.equal(absent.found, false);
assert.equal(absent.globalRank, null);
assert.equal(absent.referringSubnets, null);

const ranked = parseTrancoRankResponse({ domain: 'github.com', ranks: [{ date: '2026-07-16', rank: 31 }, { date: '2026-06-16', rank: 40 }] }, 'github.com');
assert.equal(ranked.status, 'measured');
assert.equal(ranked.history[0].rank, 31);
assert.equal(ranked.history[1].rank, 40);
const unranked = parseTrancoRankResponse({ ranks: [] }, 'taxcare.com.np');
assert.equal(unranked.status, 'not_ranked');
assert.deepEqual(unranked.history, []);
assert.throws(() => parseTrancoRankResponse({ values: [] }, 'example.com'), /format/);
assert.throws(() => parseTrancoRankResponse({ domain: 'other.example', ranks: [] }, 'example.com'), /different domain/);

const source = await readFile('src/lib/backlinks/public-link-signals.ts', 'utf8');
const client = await readFile('src/components/backlinks/DomainStrengthCard.tsx', 'utf8');
const api = await readFile('src/api/middleware-router.ts', 'utf8');
const route = await readFile('src/api/providers-router.ts', 'utf8');
const http = await readFile('src/lib/backlinks/provider-http.ts', 'utf8');
const cache = await readFile('src/lib/backlinks/domain-evidence-cache.ts', 'utf8');
const opr = await readFile('src/lib/backlinks/open-page-rank.ts', 'utf8');
assert.match(source, /const LINK_PROVIDER_ORIGIN = 'https:\/\/majestic\.com'/);
assert.match(source, /const RANK_PROVIDER_ORIGIN = 'https:\/\/tranco-list\.eu'/);
assert.match(http, /MAX_RANK_RESPONSE_BYTES/);
assert.match(source, /Promise\.allSettled/);
assert.match(source, /inFlight/);
assert.match(source, /RANK_PROVIDER_INTERVAL_MS/);
assert.match(source, /ERROR_RETRY_MS/);
assert.match(http, /AbortController/);
assert.match(cache, /domain_evidence_cache/);
assert.match(cache, /EVIDENCE_FRESH_MS = 24/);
assert.match(cache, /EVIDENCE_STALE_MS = 7/);
assert.match(opr, /https:\/\/openpagerank\.keywordseverywhere\.com\/v1\/domains\/bulk/);
assert.match(opr, /Authorization: `Bearer/);
assert.doesNotMatch(source, /fetch\(linkProviderUrl|Accept: 'text\/html/);
assert.doesNotMatch(source, /process\.env\..*(MAJESTIC|TRANCO|BACKLINK)/i, 'The adapters must not require a provider key.');
assert.match(api, /public-link-signals.*maxRequests: 20/);
assert.match(route, /normalizeUserUrl\(rawDomain\)/);
assert.match(route, /'Cache-Control', 'no-store'/);
assert.doesNotMatch(route, /stale-while-revalidate/);
assert.doesNotMatch(client, /public-link-signals['"]/i, 'The browser must import only shared domain-signal types, not the server provider module.');
assert.match(client, /Crawlio Site Strength/);
assert.match(client, /Methodology and sources/);
assert.doesNotMatch(client, /Public backlink signals|Outside top million/);

console.log('Domain signal provider smoke test passed.');
