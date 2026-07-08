import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeSupabaseProjectUrl } from './url';

let cachedClient: SupabaseClient | null | undefined;

export function hasSupabaseClientConfig() {
  return Boolean(normalizeSupabaseProjectUrl(import.meta.env.VITE_SUPABASE_URL) && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function getSupabaseBrowserClient() {
  if (!hasSupabaseClientConfig()) {
    return null;
  }

  if (cachedClient === undefined) {
    const supabaseUrl = normalizeSupabaseProjectUrl(import.meta.env.VITE_SUPABASE_URL);
    cachedClient = createClient(
      supabaseUrl,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
      },
    );
  }

  return cachedClient;
}

export const supabase = getSupabaseBrowserClient();
