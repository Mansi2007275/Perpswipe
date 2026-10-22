// Every endpoint, address and key PerpSwipe uses, validated once with zod.
//
// Two halves, deliberately separate:
//   publicEnv  — NEXT_PUBLIC_*, inlined into the browser bundle. Validated at import.
//   serverEnv() — secrets. Only ever called from route handlers and scripts, and it
//                 throws a message naming the missing key rather than returning "".
//
// NEXT_PUBLIC_* values must be written as literal `process.env.NEXT_PUBLIC_X` for Next
// to inline them, which is why they are spelled out instead of read from a loop.
import { z } from "zod";

const url = z.string().url();
const wsUrl = z
  .string()
  .refine((v) => /^wss?:\/\//.test(v), { message: "must start with ws:// or wss://" });

/** Verified defaults: Hideki testnet (= Somnia Tokyo) and its dreamDEX indexer. */
export const DEFAULTS = {
  hidekiRpcUrl: "https://api.hideki2.infra.testnet.somnia.network",
  hidekiWsUrl: "wss://api.hideki2.infra.testnet.somnia.network/ws",
  shannonRpcUrl: "https://api.infra.testnet.somnia.network",
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
} as const;

export const HIDEKI_CHAIN_ID = 50383;
export const SHANNON_CHAIN_ID = 50312;

const publicSchema = z.object({
  hidekiRpcUrl: url.default(DEFAULTS.hidekiRpcUrl),
  hidekiWsUrl: wsUrl.default(DEFAULTS.hidekiWsUrl),
  shannonRpcUrl: url.default(DEFAULTS.shannonRpcUrl),
  indexerUrl: url.default(DEFAULTS.indexerUrl),
  walletConnectProjectId: z.string().trim().min(1).optional(),
  supabaseUrl: url.optional(),
  supabaseAnonKey: z.string().trim().min(1).optional(),
});

/** Treat an unset or blank env var as absent, so `KEY=` in .env behaves like no key. */
const orUndefined = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

function readPublic() {
  const parsed = publicSchema.safeParse({
    hidekiRpcUrl: orUndefined(process.env.NEXT_PUBLIC_HIDEKI_RPC_URL),
    hidekiWsUrl: orUndefined(process.env.NEXT_PUBLIC_HIDEKI_WS_URL),
    shannonRpcUrl: orUndefined(process.env.NEXT_PUBLIC_SHANNON_RPC_URL),
    indexerUrl: orUndefined(process.env.NEXT_PUBLIC_DREAMDEX_INDEXER_URL),
    walletConnectProjectId: orUndefined(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
    supabaseUrl: orUndefined(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: orUndefined(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  NEXT_PUBLIC_${snake(String(i.path[0]))}: ${i.message}`);
    throw new Error(`PerpSwipe environment is wrong. Fix these in .env (see .env.example):\n${lines.join("\n")}`);
  }
  return parsed.data;
}

const SNAKE: Record<string, string> = {
  hidekiRpcUrl: "HIDEKI_RPC_URL",
  hidekiWsUrl: "HIDEKI_WS_URL",
  shannonRpcUrl: "SHANNON_RPC_URL",
  indexerUrl: "DREAMDEX_INDEXER_URL",
  walletConnectProjectId: "WALLETCONNECT_PROJECT_ID",
  supabaseUrl: "SUPABASE_URL",
  supabaseAnonKey: "SUPABASE_ANON_KEY",
};
const snake = (k: string) => SNAKE[k] ?? k;

export const publicEnv = readPublic();

/** Supabase is optional: without it the app runs with no history, leaderboard or server streak. */
export const supabaseConfigured = !!(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);

/** Shannon USDso. Public `mint(address,uint256)` on testnet, 18 decimals. */
export const SHANNON_USDSO = "0x9c32f3827a1a99f0cf9b213de8b53ec3d57bb171" as const;
export const SHANNON_FAUCET = "https://testnet.somnia.network/";

// ---------------------------------------------------------------- server only

/**
 * Secrets. Throws with the exact env var name when one is missing, so a 500 in a
 * route handler says what to put in .env instead of "undefined".
 */
export function requireServerEnv<K extends "SUPABASE_SERVICE_ROLE_KEY" | "CRON_SECRET">(key: K): string {
  const v = orUndefined(process.env[key]);
  if (!v) throw new Error(`${key} is not set. Add it to .env (see .env.example).`);
  return v;
}

/** Optional secrets: absent means "turn the feature off", never "use a fake value". */
export const optionalServerEnv = {
  aiApiKey: () => orUndefined(process.env.AI_API_KEY),
  serviceRoleKey: () => orUndefined(process.env.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: () => orUndefined(process.env.CRON_SECRET),
};

/** True when the route handlers can write to Supabase. */
export const serverDbConfigured = () => supabaseConfigured && !!optionalServerEnv.serviceRoleKey();
