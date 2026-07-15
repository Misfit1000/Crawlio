import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeAuditTarget } from '../src/lib/url/normalize-audit-target';

const accepted: Array<[string, string]> = [
  ['Bathuwa.com', 'https://bathuwa.com/'],
  ['example.com', 'https://example.com/'],
  ['WWW.EXAMPLE.COM', 'https://www.example.com/'],
  ['example.com/page?view=1#section', 'https://example.com/page?view=1'],
  ['https://example.com', 'https://example.com/'],
  ['http://example.com:80/path', 'http://example.com/path'],
  ['  “Bathuwa.com”  ', 'https://bathuwa.com/'],
  ['bücher.de', 'https://xn--bcher-kva.de/'],
];
for (const [input, expected] of accepted) {
  const result = normalizeAuditTarget(input);
  assert.equal(result.isValid, true, `${input} should be accepted: ${result.error}`);
  assert.equal(result.normalizedUrl, expected);
}

for (const input of ['ftp://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'localhost', '127.0.0.1', '192.168.1.1']) {
  assert.equal(normalizeAuditTarget(input).isValid, false, `${input} should be rejected`);
}

for (const file of ['LandingPage.tsx', 'SeoAudit.tsx', 'SecurityAudit.tsx', 'WebsiteAnalyzer.tsx']) {
  const source = readFileSync(resolve('src/components', file), 'utf8');
  assert.equal(/type=["']url["']/.test(source), false, `${file} must not use native URL validation for audit targets`);
  assert.match(source, /AUDIT_TARGET_INPUT_PROPS/, `${file} must use the shared audit target input contract`);
}

console.log('Universal audit domain smoke test passed.');
