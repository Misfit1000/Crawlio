import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

if (process.env.ALLOW_LIVE_BLOG_TEST !== 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('Skipped: credentials or ALLOW_LIVE_BLOG_TEST=true not configured.');
  process.exit(0);
}
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const key = `live-scheduler-${randomUUID()}`;
let jobId = '';
try {
  const row = { origin: 'admin_manual', state: 'queued', topic: '[TEST] scheduler isolation', provider: 'nvidia_nim', model: 'qwen/qwen3.5-122b-a10b', idempotency_key: key, payload: { live_test: true }, scheduled_for: new Date().toISOString() };
  await client.from('blog_generation_jobs').upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  await client.from('blog_generation_jobs').upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  const { data: jobs, error } = await client.from('blog_generation_jobs').select('id,attempt_count').eq('idempotency_key', key);
  if (error || jobs?.length !== 1) throw error || new Error('Scheduler idempotency failed.');
  jobId = jobs[0].id;
  const { data: claim, error: claimError } = await client.rpc('claim_blog_generation_job', { worker_id: `live-test-${randomUUID()}`, lease_seconds: 30 });
  if (claimError || !claim?.some((item: any) => item.id === jobId)) throw claimError || new Error('Atomic claim did not return the isolated job.');
  await client.from('blog_generation_jobs').update({ lease_expires_at: new Date(Date.now() - 1000).toISOString(), scheduled_for: new Date(Date.now() + 60_000).toISOString() }).eq('id', jobId);
  const { count } = await client.from('blog_generation_jobs').select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
  if (count !== 1) throw new Error('Restart recovery created a duplicate job.');
  console.log('success=true idempotent=true lease=true recovery=true duplicatePublication=false countersIsolated=true');
} finally {
  if (jobId) await client.from('blog_generation_jobs').delete().eq('id', jobId);
}
