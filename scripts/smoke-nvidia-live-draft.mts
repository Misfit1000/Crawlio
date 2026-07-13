import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { generateNvidiaStructuredOutput, getNvidiaBlogConfiguration } from '../src/lib/blog/nvidia';

if (process.env.ALLOW_LIVE_BLOG_TEST !== 'true' || process.env.NVIDIA_BLOG_ENABLED !== 'true' || !process.env.NVIDIA_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('Skipped: credentials or ALLOW_LIVE_BLOG_TEST=true not configured.');
  process.exit(0);
}
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const config = getNvidiaBlogConfiguration();
const idempotencyKey = `live-draft-${randomUUID()}`;
let jobId = '';
try {
  const { data: job, error } = await client.from('blog_generation_jobs').insert({ origin: 'admin_manual', state: 'drafting', topic: '[TEST] NVIDIA structured draft', provider: 'nvidia_nim', model: config.model, idempotency_key: idempotencyKey, payload: { live_test: true } }).select('id').single();
  if (error) throw error;
  jobId = job.id;
  const result = await generateNvidiaStructuredOutput({ schemaName: 'live draft fixture', system: 'Return JSON only. This is a connectivity test; do not publish.', user: 'Return an object with title "[TEST] NVIDIA draft" and a body string of two short factual sentences about HTML title elements. Do not cite current events.', validate: (value): value is { title: string; body: string } => Boolean(value && typeof value === 'object' && typeof (value as any).title === 'string' && typeof (value as any).body === 'string'), temperature: 0.2, topP: 0.8, maxTokens: 180, maxAttempts: 1 });
  await client.from('blog_generation_jobs').update({ state: 'ready_for_review', result: { structured: true, provider: 'nvidia_nim', model: result.model }, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens }).eq('id', jobId);
  console.log(`success=true provider=nvidia_nim model=${result.model} structured=true published=false`);
} finally {
  if (jobId) await client.from('blog_generation_jobs').delete().eq('id', jobId);
}
