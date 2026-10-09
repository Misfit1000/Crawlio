import { after, before, mock } from 'node:test';
import { requireSupabaseAdminClient } from '../lib/supabase/server';

const saved = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key]] as const);

before(() => {
  process.env.SUPABASE_URL = 'https://audit-worker-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
  const client = requireSupabaseAdminClient();
  const rpc = client.rpc;
  // Run the existing lease/shutdown fixtures unchanged against a rolled-back schema.
  mock.method(client, 'rpc', function (name: string, ...args: unknown[]) {
    if (name === 'read_scalable_audit_frontier') return Promise.resolve({
      data: null, error: { code: 'PGRST202', message: 'Could not find public.read_scalable_audit_frontier in the schema cache' },
    });
    return rpc.apply(client, [name, ...args] as Parameters<typeof rpc>);
  });
});

after(() => {
  mock.restoreAll();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

await import('./scalable-audit-worker.test');
