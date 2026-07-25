import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[Supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en job-radar-apify/.env"
  );
}

// This only catches the vars being absent at build time. A present-but-wrong
// key (wrong project, rotated, copy-paste error) passes this check and only
// surfaces later as an "Invalid API key" response — see auth-provider.tsx's
// isSupabaseConfigError handling for that case.

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
