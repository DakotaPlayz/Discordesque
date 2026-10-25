import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

// GitHub Pages works as the free, public email confirmation landing page.
// This is the same destination for registrations made on Windows, Android and iOS.
export const confirmationUrl = 'https://dakotaplayz.github.io/Discordesque/?confirmed=1';

export const configured = Boolean(
  url && key && /^https:\/\//.test(url) && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_SUPABASE')
);

export const supabase = configured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The browser confirmation link includes a URL fragment with a one-time session.
        // Only the hosted website needs to read it; mobile/desktop users sign in normally.
        detectSessionInUrl: window.location.hostname === 'dakotaplayz.github.io',
      },
    })
  : null;
