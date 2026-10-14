import assert from 'node:assert/strict';
import test from 'node:test';
import { publicResourceUrl, browserResponseHeaders, CAPTURE_POLICY, webpDimensions } from './capture-policy';
import { mockWebp } from '../../workers/site-preview/test-fixtures';

test('resource safety rejects unsafe protocols, credentials, private literals and recursive origins', () => {
  for (const value of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://[::1]/', 'http://localhost/',
    'https://user:password@example.com/', 'https://example.com:8080/', 'https://control.example.com/']) {
    assert.throws(() => publicResourceUrl(value, ['https://control.example.com']));
  }
  assert.equal(publicResourceUrl('https://example.com/page#anchor'), 'https://example.com/page');
  const headers = browserResponseHeaders({ 'set-cookie': 'secret', authorization: 'secret', location: '/next' }, true, 'https://example.com/', []);
  assert.equal(headers.location, 'https://example.com/next');
  assert.equal(headers['set-cookie'], undefined);
  assert.match(headers['content-security-policy'], /worker-src 'none'/);
  assert.equal(CAPTURE_POLICY.dailyBudgetMs, 480000);
  assert.deepEqual(webpDimensions(mockWebp(390, 844)), { width: 390, height: 844 });
});
