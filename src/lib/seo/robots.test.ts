import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
  createRobotsFetchEvidence, DEFAULT_ROBOTS_USER_AGENT, evaluateRobots,
  getSitemapUrlsFromRobots, isBlockedByRobots, parseRobotsTxt,
  ROBOTS_MAX_BYTES, ROBOTS_MAX_RAW_BYTES, ROBOTS_MAX_WARNINGS,
  type LegacyRobotsRules, type RobotsDocument,
} from './robots-evaluator';
import { fetchRobotsEvidence, fetchRobotsTxt, parseRobotsTxt as serverParseRobotsTxt } from './robots';

test('specific crawler groups override wildcard and shorter product matches', () => {
  const text = 'User-agent: *\nDisallow: /\nUser-agent: Example\nDisallow: /short\nUser-agent: ExampleBot\nDisallow: /private';
  const result = evaluateRobots(text, '/public', 'Mozilla/5.0 (EXAMPLEBOT/1.0)');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.groups, ['ExampleBot']);
  assert.deepEqual(result.selectedGroup, {
    kind: 'specific', specificity: 10, groupIndexes: [2], userAgents: ['ExampleBot'], lines: [5],
  });
  assert.equal(evaluateRobots(text, '/private', 'examplebot').blocked, true);
  assert.equal(evaluateRobots(text, '/short', 'examplebot').allowed, true);
  assert.equal(evaluateRobots(text, '/public', 'OtherBot').blocked, true);
  assert.equal(evaluateRobots('User-agent: OtherBot\nDisallow: /', '/', 'ExampleBot').selectedGroup, null);
});

test('consecutive agents share rules and equally specific groups combine with line evidence', () => {
  const text = '# comment\r\nUser-agent: ExampleBot\r\nUser-agent: OtherBot\r\nDisallow: /private\r\n\r\nUser-agent: examplebot\r\nAllow: /private/public\r\nDisallow: /second';
  const parsed = parseRobotsTxt(text);
  assert.equal(parsed.groups.length, 2);
  assert.equal(evaluateRobots(parsed, '/private', 'OtherBot').blocked, true);
  const result = evaluateRobots(parsed, '/private/public', 'ExampleBot');
  assert.deepEqual(result.selectedGroup?.groupIndexes, [0, 1]);
  assert.equal(result.matchedRule?.line, 7);
  assert.equal(result.matchedRule?.groupIndex, 1);
  assert.equal(result.matchedRule?.path, '/private/public');
  assert.equal(result.allowed, true);
  assert.equal(evaluateRobots(parsed, '/second', 'ExampleBot').blocked, true);
});

test('empty rules delimit groups, and a final specific empty group allows everything', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /\nUser-agent: ExampleBot\nDisallow:\nUser-agent: FinalBot');
  assert.equal(parsed.groups.length, 3);
  assert.equal(evaluateRobots(parsed, '/anything', 'ExampleBot').allowed, true);
  assert.equal(evaluateRobots(parsed, '/anything', 'FinalBot').allowed, true);
  assert.equal(evaluateRobots(parsed, '/anything', 'OtherBot').blocked, true);
});

test('longest matching rule wins, equal Allow wins independently of line order', () => {
  const parsed = parseRobotsTxt('User-agent: *\nAllow: /\nDisallow: /private\nAllow: /private/public\nDisallow: /private/public/secret');
  for (const [path, blocked, line] of [
    ['/other', false, 2], ['/private', true, 3], ['/private/public', false, 4], ['/private/public/secret', true, 5],
  ] as const) {
    const result = evaluateRobots(parsed, path);
    assert.equal(result.blocked, blocked, path);
    assert.equal(result.matchedRule?.line, line, path);
  }
  for (const rules of ['Allow: /same\nDisallow: /same', 'Disallow: /same\nAllow: /same']) {
    assert.equal(evaluateRobots(`User-agent: *\n${rules}`, '/same').allowed, true);
  }
  assert.equal(evaluateRobots(parsed, '/PRIVATE').allowed, true, 'Paths are case-sensitive.');
});

test('wildcards, end anchors, literal regex characters, query strings and fragments', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /*.php$\nDisallow: /search?private=\nDisallow: /a.b+[c]\nDisallow: *.gif$\nDisallow: /repeat*tail$');
  for (const [path, blocked] of [
    ['/nested/file.php', true], ['/file.php?download=1', false], ['/file.php/more', false],
    ['/search?private=1', true], ['/search?public=1', false], ['/search', false],
    ['/a.b+[c]', true], ['/axbccc', false], ['/image.gif', true], ['/IMAGE.GIF', false],
    ['/repeattailtail', true], ['/repeatmiddle-tail', true], ['/repeat-tail-extra', false],
  ] as const) assert.equal(evaluateRobots(parsed, path).blocked, blocked, path);
  assert.equal(evaluateRobots(parsed, 'https://example.com/file.php#section').blocked, true);
  assert.equal(isBlockedByRobots('https://example.com/search?private=1#section', parsed), true);
  assert.equal(evaluateRobots('User-agent: *\nDisallow: /page\nAllow: /*.ph', '/page.php5').allowed, true);
  assert.equal(evaluateRobots('User-agent: *\nAllow: /page\nDisallow: /*.htm', '/page.htm').blocked, true);
  assert.equal(evaluateRobots('User-agent: *\nDisallow: /$', '/').blocked, true);
  assert.equal(evaluateRobots('User-agent: *\nDisallow: /$', '/?q=1').allowed, true);
});

test('percent encoding canonicalizes unreserved octets and UTF-8 without decoding URI separators', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /caf\u00e9\nDisallow: /a%2Fb\nDisallow: /literal%2A\nDisallow: /price%24\nDisallow: /hash%23\nDisallow: /%7eprivate');
  for (const path of ['/caf\u00e9', '/caf%C3%A9', '/caf%c3%a9', '/a%2fb', '/literal*', '/literal%2a', '/price$', '/hash%23', '/~private', '/%7Eprivate']) {
    assert.equal(evaluateRobots(parsed, path).blocked, true, path);
  }
  assert.equal(evaluateRobots(parsed, '/a/b').allowed, true);
  assert.equal(evaluateRobots(parsed, '/literal-other').allowed, true);
  assert.equal(evaluateRobots('User-agent: *\nDisallow: /a?b', '/a%3Fb').allowed, true);
  const equal = evaluateRobots('User-agent: *\nDisallow: /%62%61%7A\nAllow: /baz', '/%62az');
  assert.equal(equal.allowed, true);
  assert.equal(equal.matchedRule?.specificity, 4);
});

test('RFC implicit /robots.txt access and safe invalid URL fallback', () => {
  const parsed = parseRobotsTxt('User-agent: *\nDisallow: /');
  assert.equal(evaluateRobots(parsed, '/robots.txt').reason, 'implicit-robots-allow');
  assert.equal(evaluateRobots(parsed, '/%72obots.txt?x=1').allowed, true);
  assert.equal(evaluateRobots(parsed, '/ROBOTS.txt').blocked, true);
  assert.equal(evaluateRobots(parsed, 'not a URL').reason, 'invalid-path');
  assert.equal(evaluateRobots(parsed, '/broken\ud800').diagnostics.at(-1)?.code, 'invalid-path');
  assert.equal(isBlockedByRobots('not a URL', parsed), false);
  assert.equal(isBlockedByRobots('https://example.com/', null), false);
});

test('BOM, all line endings, comments and extension records preserve group boundaries', () => {
  const text = '\uFEFFUSER-AGENT: ExampleBot\rSitemap: https://example.com/map.xml\r\n\nCrawl-delay: 10\nUser-agent: OtherBot\rDisallow: /private # comment\nAllow: /private/public\nSitemap: https://other.example/map.xml';
  const parsed = parseRobotsTxt(text);
  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.groups[0].userAgents.length, 2);
  assert.equal(evaluateRobots(parsed, '/private', 'ExampleBot').blocked, true);
  assert.equal(evaluateRobots(parsed, '/private/public', 'OtherBot').matchedRule?.line, 7);
  assert.deepEqual(getSitemapUrlsFromRobots(text), ['https://example.com/map.xml', 'https://other.example/map.xml']);
  assert.deepEqual(parsed.diagnostics.map((warning) => [warning.code, warning.line]), [['unsupported-directive', 4]]);
  assert.match(parsed.warnings[0], /^Line 4:/);
});

test('malformed records warn, preserve valid rules, and never attach invalid groups to preceding agents', () => {
  const text = 'Disallow: /orphan\nUser-agent: *\nDisallow: /valid\nbad line\nAllow: relative\nDisallow: /bad%zz\nSitemap: javascript:alert(1)\nUser-agent: Broken/1.0\nDisallow: /not-global\nUser-agent: GoodBot\nDisallow: /good';
  const parsed = parseRobotsTxt(text);
  assert.equal(evaluateRobots(parsed, '/valid').blocked, true);
  assert.equal(evaluateRobots(parsed, '/not-global').allowed, true);
  assert.equal(evaluateRobots(parsed, '/good', 'GoodBot').blocked, true);
  assert.deepEqual(parsed.diagnostics.map((warning) => [warning.code, warning.line]), [
    ['orphan-rule', 1], ['malformed-line', 4], ['invalid-rule', 5], ['invalid-rule', 6],
    ['invalid-sitemap', 7], ['invalid-user-agent', 8], ['orphan-rule', 9],
  ]);
  assert.deepEqual(parsed.sitemaps, []);
});

test('default-crawler arrays and JSON round trips preserve new and legacy evaluation contracts', () => {
  assert.equal(serverParseRobotsTxt, parseRobotsTxt, 'Server and browser entries use exactly one parser.');
  const parsed = parseRobotsTxt(`User-agent: *\nDisallow: /global\nUser-agent: ${DEFAULT_ROBOTS_USER_AGENT}\nDisallow: /private\nAllow: /private/public`);
  assert.deepEqual(parsed.allow, ['/private/public']);
  assert.deepEqual(parsed.disallow, ['/private']);
  const restored = JSON.parse(JSON.stringify(parsed)) as RobotsDocument;
  assert.equal(isBlockedByRobots('https://example.com/global', restored), false);
  assert.equal(isBlockedByRobots('https://example.com/private', restored), true);
  const legacy: LegacyRobotsRules = { allow: ['/', '/private/public'], disallow: ['/private', '/private/public/secret'] };
  assert.equal(isBlockedByRobots('https://example.com/private/public/secret', legacy), true);
  assert.equal(isBlockedByRobots('https://example.com/private/public', legacy), false);
  const result = evaluateRobots(legacy, '/private');
  assert.equal(result.selectedGroup?.kind, 'legacy');
  assert.equal(result.matchedRule?.line, null);
  assert.match(result.warnings[0], /no user-agent groups/);
  assert.equal(isBlockedByRobots('https://example.com/private', { allow: [null], disallow: ['/private', 1] }), true);
});

test('UTF-8 parsing is capped, incomplete rules are discarded, and warning output is bounded', () => {
  const prefix = 'User-agent: *\nDisallow: /early\n';
  const padding = `#${'x'.repeat(ROBOTS_MAX_BYTES - prefix.length - 2)}\n`;
  const atLimit = parseRobotsTxt(prefix + padding);
  assert.equal(atLimit.byteLength, ROBOTS_MAX_BYTES);
  assert.equal(atLimit.truncated, false);
  const beyond = parseRobotsTxt(prefix + padding + 'Disallow: /late');
  assert.equal(beyond.byteLength, ROBOTS_MAX_BYTES);
  assert.equal(beyond.truncated, true);
  assert.equal(evaluateRobots(beyond, '/early').blocked, true);
  assert.equal(evaluateRobots(beyond, '/late').allowed, true);
  const partial = parseRobotsTxt(`${prefix}Disallow: /${'x'.repeat(ROBOTS_MAX_BYTES)}`);
  assert.equal(partial.groups[0].rules.length, 1);
  const unicode = parseRobotsTxt(`User-agent: *\nDisallow: /${'\u{1F600}'.repeat(ROBOTS_MAX_BYTES)}`);
  assert(unicode.byteLength <= ROBOTS_MAX_BYTES);
  assert.equal(unicode.truncated, true);
  const warnings = parseRobotsTxt('bad line\n'.repeat(ROBOTS_MAX_WARNINGS + 10)).diagnostics;
  assert.equal(warnings.length, ROBOTS_MAX_WARNINGS);
  assert.equal(warnings.at(-1)?.code, 'warnings-truncated');
});

test('adversarial repeated wildcards match without regex backtracking', { timeout: 2_000 }, () => {
  const text = `User-agent: *\nDisallow: /${'*a'.repeat(2_000)}b$`;
  assert.equal(evaluateRobots(text, `/${'a'.repeat(10_000)}`).allowed, true);
  assert.equal(evaluateRobots(text, `/${'a'.repeat(10_000)}b`).blocked, true);
  const repetitive = `User-agent: *\nDisallow: /*${'a'.repeat(20_000)}b*`;
  assert.equal(evaluateRobots(repetitive, `/${'a'.repeat(100_000)}`).allowed, true);
  assert.equal(evaluateRobots(repetitive, `/${'a'.repeat(100_000)}b`).blocked, true);
});

test('already-fetched evidence distinguishes all states and never parses HTTP error bodies', () => {
  const fetchedAt = '2026-10-02T00:00:00.000Z';
  for (const status of [404, 410]) {
    const missing = createRobotsFetchEvidence({ status, body: 'User-agent: *\nDisallow: /', fetchedAt });
    assert.equal(missing.state, 'missing');
    assert.equal(missing.policy, 'allow-all');
    assert.equal(missing.statusCode, status);
    assert.equal(missing.document, undefined);
    assert.equal(missing.fetchedAt, fetchedAt);
  }
  for (const status of [301, 401, 403, 429, 500, 503]) {
    const unavailable = createRobotsFetchEvidence({ status, body: '' });
    assert.equal(unavailable.state, 'unavailable', String(status));
    assert.equal(unavailable.policy, 'disallow-all');
    assert.equal(unavailable.document, undefined);
  }
  assert.equal(createRobotsFetchEvidence({ status: 200 }).state, 'unavailable', 'Absent body is not empty success.');
  assert.equal(createRobotsFetchEvidence({ body: '' }).state, 'unavailable', 'Absent status is not success.');
  for (const body of ['', ' \t\r\n', '\uFEFF# comment\n']) {
    const empty = createRobotsFetchEvidence({ status: 200, body });
    assert.equal(empty.state, 'empty');
    assert.equal(empty.policy, 'allow-all');
  }
  const malformed = createRobotsFetchEvidence({ status: 200, body: '<html>Not robots</html>' });
  assert.equal(malformed.state, 'malformed');
  assert.equal(malformed.document?.diagnostics[0].code, 'malformed-line');
  const available = createRobotsFetchEvidence({ status: 200, body: 'bad line\nUser-agent: *\nDisallow: /private', fetchedAt });
  assert.equal(available.state, 'available');
  assert.equal(available.document?.diagnostics[0].line, 1);
  assert.equal(evaluateRobots(available.document!, '/private').blocked, true);
  const failure = createRobotsFetchEvidence({ status: 200, body: '', error: true, fetchedAt });
  assert.equal(failure.state, 'unavailable');
  assert.equal(failure.policy, 'disallow-all');
  assert.equal(failure.document, undefined);
  assert.equal(failure.warnings.length, 1);
  assert.doesNotThrow(() => JSON.stringify(failure));
});

test('raw evidence is capped at 128,000 UTF-8 bytes independently of the 512,000-byte parser', () => {
  const prefix = 'User-agent: *\n';
  const body = `${prefix}#${'x'.repeat(ROBOTS_MAX_RAW_BYTES)}\nDisallow: /later`;
  const evidence = createRobotsFetchEvidence({ status: 200, body, url: 'https://example.com/robots.txt' });
  assert.equal(evidence.state, 'available');
  assert.equal(evidence.truncated, true);
  assert.equal(evidence.document?.truncated, false);
  assert.match(evidence.warnings[0], /Retained raw/);
  assert(evidence.byteLength <= ROBOTS_MAX_RAW_BYTES);
  assert.equal(Buffer.byteLength(evidence.raw, 'utf8'), evidence.byteLength);
  assert.equal(evidence.raw, prefix, 'Incomplete raw lines must not become broader pasted rules.');
  assert.equal(evaluateRobots(evidence.document!, '/later').blocked, true);
  assert.equal(evidence.url, 'https://example.com/robots.txt');
  const unicode = createRobotsFetchEvidence({ status: 200, body: '\u{1F600}\n'.repeat(ROBOTS_MAX_BYTES) });
  assert.equal(unicode.byteLength, ROBOTS_MAX_RAW_BYTES);
  assert.equal(Buffer.byteLength(unicode.raw, 'utf8'), ROBOTS_MAX_RAW_BYTES);
  assert.equal(unicode.raw.endsWith('\u{1F600}\n'), true);
  assert.equal(unicode.document?.truncated, true);
});

test('evaluation accepts fetch evidence and keeps unavailable state conservative', () => {
  const missing = createRobotsFetchEvidence({ status: 404, body: 'User-agent: *\nDisallow: /' });
  assert.equal(evaluateRobots(missing, '/private', 'ExampleBot').allowed, true);
  assert.equal(evaluateRobots(missing, '/private', 'ExampleBot').reason, 'robots-missing');
  const unavailable = createRobotsFetchEvidence({ status: 503, body: 'User-agent: *\nAllow: /' });
  assert.equal(evaluateRobots(unavailable, '/private', 'ExampleBot').allowed, false);
  assert.equal(isBlockedByRobots('https://example.com/private', unavailable), true);
  const available = createRobotsFetchEvidence({ status: 200, body: 'User-agent: *\nDisallow: /private' });
  assert.equal(evaluateRobots(available, '/private', 'ExampleBot').matchedRule?.line, 2);
  assert.equal(evaluateRobots(available, '/public', 'ExampleBot').allowed, true);
  const restored = JSON.parse(JSON.stringify(available));
  delete restored.document;
  assert.equal(evaluateRobots(restored, '/private', 'ExampleBot').blocked, true);
});

test('browser parser imports produce no server fetch or Node runtime code', async () => {
  const result = await build({
    stdin: {
      contents: 'import { parseRobotsTxt, evaluateRobots, createRobotsFetchEvidence } from "./src/lib/seo/robots-evaluator"; globalThis.result = { parsed: parseRobotsTxt("User-agent: *\\nDisallow: /private"), evaluation: evaluateRobots("User-agent: *\\nDisallow: /private", "/private"), evidence: createRobotsFetchEvidence({status: 404}) };',
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, platform: 'browser', format: 'iife', write: false, metafile: true,
  });
  const code = result.outputFiles[0].text;
  assert.doesNotMatch(code, /node:|safePublicFetch|safe-public-fetch|__require/);
  assert(Object.keys(result.metafile!.inputs).every((input) => input === '<stdin>' || input.endsWith('robots-evaluator.ts')));
  const sandbox: { URL: typeof URL; result?: { evaluation: { blocked: boolean }; evidence: { state: string }; parsed: { disallow: string[] } } } = { URL };
  runInNewContext(code, sandbox);
  assert.equal(sandbox.result?.evaluation.blocked, true);
  assert.equal(sandbox.result?.evidence.state, 'missing');
  assert.equal(sandbox.result?.parsed.disallow[0], '/private');
});

test('fetch evidence makes one request and legacy fetch preserves success bodies and failed fallbacks', async () => {
  let status = 200;
  let body = 'User-agent: *\nDisallow: /private';
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    assert.equal(request.url, '/robots.txt');
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}/nested`;
    const options = { allowPrivateForTesting: true, allowNonStandardPortsForTesting: true, timeoutMs: 1_000 };
    const evidence = await fetchRobotsEvidence(origin, options);
    assert.equal(requests, 1);
    assert.equal(evidence.state, 'available');
    assert.equal(evidence.raw, body);
    assert.equal(evidence.statusCode, 200);
    assert.equal(evidence.url, `http://127.0.0.1:${address.port}/robots.txt`);
    assert.equal(await fetchRobotsTxt(origin, options), body);
    status = 404;
    assert.equal((await fetchRobotsEvidence(origin, options)).policy, 'allow-all');
    assert.equal(await fetchRobotsTxt(origin, options), '');
    status = 503;
    assert.equal((await fetchRobotsEvidence(origin, options)).policy, 'disallow-all');
    assert.equal(await fetchRobotsTxt(origin, options), '');
    status = 200;
    body = `${'x'.repeat(ROBOTS_MAX_RAW_BYTES - 1)}\nextra`;
    assert.equal(await fetchRobotsTxt(origin, options), body, 'Legacy strings retain their larger cap.');
    assert.equal((await fetchRobotsEvidence(origin, options)).raw.length, ROBOTS_MAX_RAW_BYTES);
    body = 'x'.repeat(ROBOTS_MAX_BYTES + 1);
    assert.equal((await fetchRobotsEvidence(origin, { ...options, maxBytes: ROBOTS_MAX_BYTES * 2 })).state, 'unavailable');
    assert.equal(await fetchRobotsTxt(origin, { ...options, maxBytes: ROBOTS_MAX_BYTES * 2 }), '');
    assert.equal(await fetchRobotsTxt('not a URL'), '');
    assert.equal((await fetchRobotsEvidence('not a URL')).state, 'unavailable');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
