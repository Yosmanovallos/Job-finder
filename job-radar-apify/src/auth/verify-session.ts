import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import type { IncomingMessage } from 'http';
import { getOrCreateUser } from '../db/job-repository.js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Auth] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en job-radar-apify/.env'
  );
}

const supabaseServer = createClient(supabaseUrl, supabaseAnonKey);

export interface VerifiedSession {
  id: string;
  email: string;
  tier: 'free' | 'pro';
}

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Verifies the Supabase JWT from the Authorization header against Supabase's
 * auth server — never trusts a client-supplied user id or tier — then
 * upserts/loads the matching Postgres row to resolve the real subscription tier.
 */
export async function verifySession(req: IncomingMessage): Promise<VerifiedSession | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data.user) return null;

  const appUser = await getOrCreateUser(data.user.id, data.user.email || '', data.user.user_metadata?.full_name);
  return { id: appUser.id, email: appUser.email, tier: appUser.subscriptionTier };
}
