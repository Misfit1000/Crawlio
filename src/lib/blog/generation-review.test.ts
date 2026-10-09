import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectBlogGenerationReview } from './generation-review';

test('only an explicit supported result passes generation review', () => {
  assert.equal(projectBlogGenerationReview({ claimsSupported: true }).status, 'passed');
  assert.equal(projectBlogGenerationReview({ claimsSupported: false }).status, 'needs_review');
  for (const value of [null, {}, { claimsSupported: 'true' }]) {
    assert.equal(projectBlogGenerationReview(value).status, 'unavailable');
  }
});

test('review projection is bounded, deduplicated, redacted and excludes raw evidence', () => {
  const result = projectBlogGenerationReview({ claimsSupported: false,
    warnings: ['<b>Review this claim</b>', 'Review this claim', 123, 'Bearer credential', 'gsk_secret', ...Array.from({ length: 40 }, (_, i) => `${i}${'x'.repeat(900)}`)],
    publicationRecommendation: 'y'.repeat(2000), sourceText: 'private evidence', apiKey: 'secret' });
  assert.equal(result.warnings.length, 30);
  assert.equal(result.warnings[0], 'Review this claim');
  assert.equal(result.warnings[1], '[redacted]');
  assert.ok(result.warnings.every((item) => item.length <= 800));
  assert.equal(result.recommendation.length, 1600);
  assert.deepEqual(Object.keys(result), ['status', 'warnings', 'recommendation']);
});
