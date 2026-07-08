import assert from 'node:assert/strict';
import { normalizeUserUrl } from '../src/lib/seo/url-utils.ts';

const pass = [
  'example.com',
  'www.example.com',
  'https://example.com',
  'http://example.com',
  'example.com/about',
  'www.example.com/services?utm_source=x',
  'example.com/page#section',
];

const fail = [
  'random text',
  'javascript:alert(1)',
  'data:text/html,test',
  'ftp://example.com',
  'http://',
  '.com',
];

for (const input of pass) {
  const result = normalizeUserUrl(input);
  assert.equal(result.isValid, true, `${input} should pass: ${result.error || ''}`);
  assert.match(result.normalizedUrl, /^https?:\/\//);
  assert.equal(result.normalizedUrl.includes('#'), false, `${input} should drop fragments`);
}

for (const input of fail) {
  const result = normalizeUserUrl(input);
  assert.equal(result.isValid, false, `${input} should fail`);
}

console.log('URL normalization smoke test passed.');
