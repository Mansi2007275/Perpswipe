// Two Supabase clients, and they must not be mixed up.
//
//   browserDb()  anon key, read-only by RLS. Safe in client components.
//   serverDb()   service role key, bypasses RLS. Route handlers only — importing
//                this from a client component would ship the key to the browser.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, requireServerEnv, supabaseConfigured } from "./env";

export type TradeRow = {
  id: string;
  wallet: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_price: number;
  margin: number;
  leverage: number;
  stop_price: number | null;
  liq_price: number | null;
  max_loss: number | null;
  open_tx: string;
  stop_tx: string | null;
  close_tx: string | null;
  close_price: number | null;
  pnl: number | null;
  status: "open" | "closed" | "stopped";
  opened_at: string;
  closed_at: string | null;
};

export type StreakRow = { wallet: string; days: number; last_day: string | null };

let browser: SupabaseClient | null = null;

/** Read-only client for the browser. Null when Supabase is not configured. */
export function browserDb(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  browser ??= createClient(publicEnv.supabaseUrl!, publicEnv.supabaseAnonKey!, {
    auth: { persistSession: false },
  });
  return browser;
}

let server: SupabaseClient | null = null;

/**
 * Service-role client. Throws when Supabase is not configured, so a route handler
 * returns one clear message instead of writing nowhere and reporting success.
 */
export function serverDb(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.");
  }
  server ??= createClient(publicEnv.supabaseUrl!, requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  return server;
}
