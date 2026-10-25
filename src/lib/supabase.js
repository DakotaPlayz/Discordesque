import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const configured = Boolean(
  url && key && /^https:\/\//.test(url) && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_SUPABASE')
);

export const supabase = configured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
