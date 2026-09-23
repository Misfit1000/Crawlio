import assert from 'node:assert/strict';
import { authorizeScheduler } from '../src/lib/api/scheduler-auth';

const env = { CRON_SECRET: 'cron-'.repeat(8), BLOG_DISPATCH_SECRET: 'dispatch-'.repeat(8) };
assert.equal(authorizeScheduler(env.CRON_SECRET, 'cron', env), true);
assert.equal(authorizeScheduler(env.BLOG_DISPATCH_SECRET, 'dispatch', env), true);
assert.equal(authorizeScheduler(env.BLOG_DISPATCH_SECRET, 'cron', env), false);
assert.equal(authorizeScheduler(env.CRON_SECRET, 'dispatch', env), false);
assert.equal(authorizeScheduler('', 'cron', env), false);
assert.equal(authorizeScheduler(env.CRON_SECRET, 'cron', {}), false);
console.log('PASS scheduler authentication: independent cron and dispatch credentials');
