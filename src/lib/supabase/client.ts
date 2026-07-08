import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null | undefined;

export function hasSupabaseClientConfig() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function getSupabaseBrowserClient() {
  if (!hasSupabaseClientConfig()) {
    return null;
  }

  if (cachedClient === undefined) {
    cachedClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
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
