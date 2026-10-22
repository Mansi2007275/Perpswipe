// Daily trading streak.
//
// With Supabase configured the streak lives on the server, keyed to the wallet, so it
// follows the trader to another browser and cannot be edited from devtools. Without
// Supabase it falls back to this browser's localStorage, which is what the app shipped
// with — a local streak is still a true statement about this browser.
import { supabaseConfigured } from "./env";
import { bumpServerStreak, readServerStreak } from "./record";

const KEY = "perpswipe.streak";
type Streak = { days: number; last: string };
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

export function readLocalStreak(): number {
  try {
    const s: Streak = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!s) return 0;
    return s.last === today() || s.last === yesterday() ? s.days : 0;
  } catch {
    return 0;
  }
}

export function bumpLocalStreak(): number {
  try {
    const s: Streak | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
    let days = 1;
    if (s?.last === today()) days = s.days;
    else if (s?.last === yesterday()) days = s.days + 1;
    localStorage.setItem(KEY, JSON.stringify({ days, last: today() }));
    return days;
  } catch {
    return 0;
  }
}

/** Where the streak comes from, so the UI can say so honestly. */
export const streakSource = supabaseConfigured ? "server" : "browser";

export async function readStreak(wallet?: string): Promise<number> {
  if (supabaseConfigured && wallet) {
    const days = await readServerStreak(wallet);
    if (days !== null) return days;
  }
  return readLocalStreak();
}

/**
 * Count today's trade. `openTx` is required for the server streak: the route only
 * bumps a wallet whose trade is already in the database, which means its receipt was
 * verified on Hideki.
 */
export async function bumpStreak(wallet?: string, openTx?: string): Promise<number> {
  if (supabaseConfigured && wallet && openTx) {
    const days = await bumpServerStreak(wallet, openTx);
    if (days !== null) return days;
  }
  return bumpLocalStreak();
}
