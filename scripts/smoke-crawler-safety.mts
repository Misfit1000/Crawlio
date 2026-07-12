import assert from 'node:assert/strict';
import { isPrivateOrReservedAddress, parsePublicHttpUrl, safePublicFetch, PublicFetchError } from '../src/lib/security/safe-public-fetch';

for (const address of ['127.0.0.1', '10.0.0.8', '172.16.0.1', '192.168.1.2', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
  assert.equal(isPrivateOrReservedAddress(address), true, `${address} must be blocked.`);
}
for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
  assert.equal(isPrivateOrReservedAddress(address), false, `${address} should be considered public.`);
}

assert.throws(() => parsePublicHttpUrl('file:///etc/passwd'), (error: unknown) => error instanceof PublicFetchError && error.code === 'UNSUPPORTED_PROTOCOL');
assert.throws(() => parsePublicHttpUrl('https://user:pass@example.com/'), (error: unknown) => error instanceof PublicFetchError && error.code === 'EMBEDDED_CREDENTIALS');
assert.throws(() => parsePublicHttpUrl('https://example.com:444/'), (error: unknown) => error instanceof PublicFetchError && error.code === 'UNSUPPORTED_PORT');

for (const target of ['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/']) {
  await assert.rejects(() => safePublicFetch(target), (error: unknown) => error instanceof PublicFetchError && error.code === 'PRIVATE_NETWORK_TARGET');
}

console.log('Crawler SSRF and URL safety smoke test passed.');
