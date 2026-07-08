import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeSupabaseProjectUrl } from './url';

let cachedClient: SupabaseClient | null | undefined;

export function hasSupabaseServerConfig() {
  return Boolean(normalizeSupabaseProjectUrl(process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdminClient() {
  if (!hasSupabaseServerConfig()) {
    return null;
  }

  if (cachedClient === undefined) {
    const supabaseUrl = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
    cachedClient = createClient(
      supabaseUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return cachedClient;
}
