import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type Bugsha = SupabaseClient<Database>;

/** One client per app. Storage adapter is injected so Expo can use SecureStore. */
export function createBugshaClient(url: string, anonKey: string, storage?: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> }): Bugsha {
  return createClient<Database>(url, anonKey, { auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
}
