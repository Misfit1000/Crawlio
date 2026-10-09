import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import {
  cloudflareSafeFetch, CloudflarePublicFetchError, createCloudflareFetchBudget,
  isCloudflarePrivateOrReservedAddress,
} from '../src/workers/cloudflare-audit/src/safe-fetch';

type Fetcher = Parameters<typeof cloudflareSafeFetch>[2];
type Options = Parameters<typeof cloudflareSafeFetch>[1];
type Reply = (url: URL, init: RequestInit) => Response | Promise<Response>;
const calls: Array<{ url: URL; init: RequestInit }> = [];
const html = (body = '<h1>Measured page</h1>', headers: Record<string, string> = {}) => new Response(body, {
  headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
});
const dns = (type: string, addresses?: string[]) => Response.json({
  Status: 0,
  Answer: (addresses ?? (type === 'A' ? ['8.8.8.8'] : ['2606:4700:4700::1111']))
    .map((data) => ({ type: data.includes(':') ? 28 : 1, data })),
}, { headers: { 'Content-Type': 'application/dns-json' } });
function mock(reply: Reply = () => html(), resolve?: Reply): Fetcher {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.hostname === 'cloudflare-dns.com') {
      assert.equal(url.pathname, '/dns-query');
      assert.equal(init.redirect, 'manual');
      assert.equal(new Headers(init.headers).get('accept'), 'application/dns-json');
      return resolve ? resolve(url, init) : dns(url.searchParams.get('type')!);
    }
    assert.equal(init.redirect, 'manual');
    return reply(url, init);
  };
}
async function rejectsCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof CloudflarePublicFetchError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /top-secret|stack trace|internal-host|169\.254\.169\.254/);
    return true;
  });
}
function cancelledStream(onCancel: () => void, chunk?: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) { if (chunk) controller.enqueue(chunk); },
    cancel: onCancel,
  });
}

let tests = 0;
async function test(name: string, run: () => void | Promise<void>) {
  calls.length = 0;
  await run();
  tests += 1;
  console.log(`PASS ${name}`);
}

await test('private/reserved IPv4, IPv6, mapped and unusual literal encodings', async () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd00::1',
    'fe80::1', 'ff02::1', '2001:db8::1', '2001:2::1', '2001:20::1', '2002:7f00:1::1',
    '64:ff9b::7f00:1', '3fff::1', '::127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '0:0:0:0:0:ffff:a00:1', 'fe80::1%eth0', 'invalid',
  ];
  for (const address of blocked) assert.equal(isCloudflarePrivateOrReservedAddress(address), true, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808']) {
    assert.equal(isCloudflarePrivateOrReservedAddress(address), false, address);
  }
  for (const target of [
    'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'http://foo.local./', 'http://metadata.google.internal/',
  ]) await rejectsCode(cloudflareSafeFetch(target, {}, mock()), 'PRIVATE_NETWORK_TARGET');
  assert.equal(calls.length, 0);
});

await test('URL/method validation has no network or test-only bypass', async () => {
  for (const [url, code] of [
    ['not a url', 'INVALID_URL'], ['file:///etc/passwd', 'UNSUPPORTED_PROTOCOL'],
    ['https://user:top-secret@example.com/', 'EMBEDDED_CREDENTIALS'], ['https://example.com:8080/', 'UNSUPPORTED_PORT'],
  ]) await rejectsCode(cloudflareSafeFetch(url, {}, mock()), code);
  const unsafe = { allowPrivateForTesting: true, allowNonStandardPortsForTesting: true } as Options;
  await rejectsCode(cloudflareSafeFetch('http://127.0.0.1/', unsafe, mock()), 'PRIVATE_NETWORK_TARGET');
  await rejectsCode(cloudflareSafeFetch('https://example.com:8080/', unsafe, mock()), 'UNSUPPORTED_PORT');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { method: 'POST' } as unknown as Options, mock()), 'REQUEST_FAILED');
  assert.equal(calls.length, 0);
});

await test('safe response contract and both DNS families', async () => {
  const result = await cloudflareSafeFetch('https://example.com./page#fragment', {}, mock());
  assert.equal(result.requestedUrl, 'https://example.com/page');
  assert.equal(result.finalUrl, result.requestedUrl);
  assert.equal(result.status, 200);
  assert.equal(result.body, '<h1>Measured page</h1>');
  assert.equal(result.bodyBytes, Buffer.byteLength(result.body));
  assert.equal(result.redirectCount, 0);
  assert.equal(result.headers['content-type'], result.contentType);
  assert.ok(result.durationMs >= 0);
  assert.equal(result.bodyBuffer, undefined);
  assert.deepEqual(calls.filter(({ url }) => url.hostname === 'cloudflare-dns.com')
    .map(({ url }) => url.searchParams.get('type')).sort(), ['A', 'AAAA']);
  assert.equal(calls.length, 3);
});

await test('fail closed on mixed DNS answers including private AAAA/mapped records', async () => {
  for (const address of ['10.1.2.3', '::ffff:169.254.169.254', 'fd12::1', '2001:db8::1']) {
    await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(undefined, (url) =>
      dns(url.searchParams.get('type')!, ['8.8.8.8', address]))), 'PRIVATE_NETWORK_TARGET');
  }
  assert.ok(calls.every(({ url }) => url.hostname === 'cloudflare-dns.com'));
});

await test('DNS failure, malformed JSON/records, truncation, no addresses, and one absent family', async () => {
  for (const response of [
    () => new Response('bad', { headers: { 'Content-Type': 'application/dns-json' } }),
    () => Response.json({ Status: 2 }),
    () => Response.json({ Status: 0, TC: true }),
    () => Response.json({ Status: 0, Answer: [{ type: 1, data: 'not-an-address' }] }),
    () => Response.json({ Status: 0, Answer: {} }),
    () => Response.json({ Status: 0, Answer: [null] }),
    () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }),
  ]) await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(undefined, response)), 'DNS_FAILURE');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(undefined, () => dns('A', []))), 'DNS_NAME_NOT_FOUND');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(undefined, () => Response.json({ Status: 3 }))), 'DNS_NAME_NOT_FOUND');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(undefined, () => {
    throw new Error('top-secret internal-host DNS error');
  })), 'DNS_FAILURE');
  const result = await cloudflareSafeFetch('https://example.com/', {}, mock(undefined, (url) =>
    dns(url.searchParams.get('type')!, url.searchParams.get('type') === 'AAAA' ? [] : ['8.8.8.8'])));
  assert.equal(result.status, 200);
});

await test('manual redirect validation, body cancellation, and per-hop DNS', async () => {
  let cancelled = false;
  const result = await cloudflareSafeFetch('https://example.com/start', {}, mock((url) =>
    url.hostname === 'example.com' ? new Response(cancelledStream(() => { cancelled = true; }), {
      status: 302, headers: { Location: 'https://other.example.com/final' },
    }) : html('final')));
  assert.equal(cancelled, true);
  assert.equal(result.redirectCount, 1);
  assert.equal(result.finalUrl, 'https://other.example.com/final');
  assert.equal(calls.length, 6);
  for (const location of ['http://169.254.169.254/', 'http://[::1]/']) {
    await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() =>
      new Response('', { status: 302, headers: { Location: location } }))), 'UNSAFE_REDIRECT_TARGET');
  }
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock((url) =>
    new Response('', { status: 302, headers: { Location: 'https://other.example.com/' } }), (url) =>
    dns(url.searchParams.get('type')!, url.searchParams.get('name') === 'other.example.com' ? ['127.0.0.1'] : undefined))),
  'UNSAFE_REDIRECT_TARGET');
});

await test('invalid, missing, excessive, and looping redirects', async () => {
  for (const [location, code] of [
    ['file:///etc/passwd', 'INVALID_REDIRECT_TARGET'], ['https://user:top-secret@other.example.com/', 'INVALID_REDIRECT_TARGET'],
    ['https://other.example.com:8080/', 'INVALID_REDIRECT_TARGET'], ['https://example.com/#again', 'REDIRECT_LOOP'],
  ]) await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() =>
    new Response('', { status: 302, headers: { Location: location } }))), code);
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() => new Response('', { status: 302 }))), 'REDIRECT_WITHOUT_LOCATION');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { maxRedirects: 0 }, mock(() =>
    new Response('', { status: 302, headers: { Location: '/next' } }))), 'TOO_MANY_REDIRECTS');
});

await test('MIME checks, missing-type opt-in, XML suffix and cancellation', async () => {
  let cancelled = false;
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() => new Response(
    cancelledStream(() => { cancelled = true; }), { headers: { 'Content-Type': 'application/octet-stream' } },
  ))), 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal(cancelled, true);
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() => new Response(new Uint8Array([1])))), 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal((await cloudflareSafeFetch('https://example.com/', { allowMissingContentType: true },
    mock(() => new Response(new Uint8Array([65]))))).body, 'A');
  assert.equal((await cloudflareSafeFetch('https://example.com/', { allowedContentTypes: ['application/xml'] },
    mock(() => html('<rss/>', { 'Content-Type': 'application/rss+xml' })))).body, '<rss/>');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { allowedContentTypes: ['text/html'] },
    mock(() => html('', { 'Content-Type': 'application/evil+html' }))), 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal((await cloudflareSafeFetch('https://example.com/', { allowedContentTypes: ['application/json'] },
    mock(() => html('{}', { 'Content-Type': 'application/ld+json' })))).body, '{}');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {},
    mock(() => html('', { 'Content-Encoding': 'unsupported' }))), 'REQUEST_FAILED');
});

await test('declared, streamed, decoded compression-bomb, and absolute byte limits', async () => {
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() => html('', {
    'Content-Length': '2000001',
  }))), 'RESPONSE_TOO_LARGE');
  let cancelled = false;
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { maxBytes: 16 }, mock(() => new Response(
    cancelledStream(() => { cancelled = true; }, new Uint8Array(17)), { headers: { 'Content-Type': 'text/html' } },
  ))), 'RESPONSE_TOO_LARGE');
  assert.equal(cancelled, true);
  const compressed = gzipSync('x'.repeat(2_000_001));
  assert.ok(compressed.byteLength < 10_000);
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { maxBytes: 10_000_000 }, mock(() => new Response(
    new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip')),
    { headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.byteLength) } },
  ))), 'RESPONSE_TOO_LARGE');
  const result = await cloudflareSafeFetch('https://example.com/', { maxBytes: 8, returnBuffer: true }, mock(() => html('12345678')));
  assert.ok(Buffer.isBuffer(result.bodyBuffer));
  assert.equal(result.bodyBuffer!.toString(), '12345678');
  assert.equal(result.body, '');
});

await test('DNS, headers and body all obey bounded deadlines even when mocks ignore abort', async () => {
  const never = () => new Promise<Response>(() => {});
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { timeoutMs: 200, dnsTimeoutMs: 15 }, mock(undefined, never)), 'DNS_TIMEOUT');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { timeoutMs: 15 }, mock(never)), 'REQUEST_TIMEOUT');
  let cancelled = false;
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { timeoutMs: 15 }, mock(() => new Response(
    cancelledStream(() => { cancelled = true; }), { headers: { 'Content-Type': 'text/html' } },
  ))), 'REQUEST_TIMEOUT');
  assert.equal(cancelled, true);
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { timeoutMs: 15, dnsTimeoutMs: 200 }, mock(undefined, never)), 'REQUEST_TIMEOUT');
});

await test('one total deadline across DNS, redirects and bodies; late responses are cancelled', async () => {
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  let cancelled = false;
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { timeoutMs: 80 }, mock(async (url) => {
    await sleep(50);
    return url.pathname === '/' ? new Response('', { status: 302, headers: { Location: '/next' } })
      : new Response(cancelledStream(() => { cancelled = true; }), { headers: { 'Content-Type': 'text/html' } });
  })), 'REQUEST_TIMEOUT');
  await sleep(60);
  assert.equal(cancelled, true);
  assert.equal(calls.filter(({ url }) => url.hostname === 'example.com').length, 2);
  const controller = new AbortController();
  const operation = cloudflareSafeFetch('https://example.com/', { signal: controller.signal }, mock(() => new Response(
    cancelledStream(() => {}), { headers: { 'Content-Type': 'text/html' } },
  )));
  setTimeout(() => controller.abort('top-secret'), 10);
  await rejectsCode(operation, 'REQUEST_FAILED');
});

await test('caller cancellation, shared subrequest budgets and sanitized transport errors', async () => {
  const controller = new AbortController();
  controller.abort('top-secret');
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { signal: controller.signal }, mock()), 'REQUEST_FAILED');
  assert.equal(calls.length, 0);
  const budget = createCloudflareFetchBudget(5);
  await cloudflareSafeFetch('https://example.com/', { subrequestBudget: budget }, mock());
  assert.equal(budget.remaining, 2);
  await rejectsCode(cloudflareSafeFetch('https://example.com/', { subrequestBudget: budget }, mock()), 'SUBREQUEST_BUDGET_EXCEEDED');
  assert.equal(budget.remaining, 0);
  assert.equal(calls.filter(({ url }) => url.hostname === 'example.com').length, 1);
  await rejectsCode(cloudflareSafeFetch('https://example.com/', {}, mock(() => {
    throw new Error('top-secret internal-host stack trace');
  })), 'REQUEST_FAILED');
});

await test('HEAD skips the body and the adapter has no runtime production HTTP/DNS imports', async () => {
  let cancelled = false;
  const result = await cloudflareSafeFetch('https://example.com/', { method: 'HEAD' }, mock(() => new Response(
    cancelledStream(() => { cancelled = true; }), { headers: { 'Content-Type': 'text/html', 'Content-Length': '9000000' } },
  )));
  assert.equal(result.bodyBytes, 0);
  assert.equal(cancelled, true);
  const bundle = await build({
    entryPoints: ['src/workers/cloudflare-audit/src/safe-fetch.ts'], bundle: true,
    platform: 'neutral', format: 'esm', external: ['node:net', 'node:buffer'], write: false, metafile: true,
  });
  assert.deepEqual(Object.keys(bundle.metafile!.inputs), ['src/workers/cloudflare-audit/src/safe-fetch.ts']);
  assert.doesNotMatch(bundle.outputFiles[0].text, /node:(?:http|https|dns)|allowPrivateForTesting|allowNonStandardPortsForTesting/);
});

console.log(`Cloudflare safe-fetch smoke passed (${tests} focused groups; mocked network, no deployment).`);
