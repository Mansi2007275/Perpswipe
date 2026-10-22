// POST /api/hint — one plain sentence about a market, for someone new to perps.
//
// Entirely optional. With no AI_API_KEY the route answers 204 and the card shows no
// hint at all: a made-up sentence about someone's money would be worse than none.
//
// The key stays on the server. The model only ever sees numbers this app already
// shows on the card, never a wallet address or a balance.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { bad, gate, json, readJson } from "@/lib/api";
import { optionalServerEnv } from "@/lib/env";
import type { Limit } from "@/lib/ratelimit";

const bodySchema = z.object({
  symbol: z.string().min(3).max(64),
  change24h: z.number().finite(),
  fundingRate: z.number().finite(),
  closes: z.array(z.number().finite()).max(96).default([]),
});

const MAX_CHARS = 90;
const CACHE_MS = 10 * 60_000;
const HINT_LIMIT: Limit = { capacity: 30, refillPerMinute: 15 };

const cache = new Map<string, { hint: string; at: number }>();

const SYSTEM = [
  "You write one short sentence for someone opening their first perpetual futures trade.",
  `Rules: under ${MAX_CHARS} characters. One sentence. Plain words, no jargon, no emoji, no hype.`,
  "Describe only what today's numbers show and whether that suggests a smaller size.",
  "Never predict a direction, never say buy or sell, never promise anything.",
].join(" ");

export async function POST(req: Request) {
  const key = optionalServerEnv.aiApiKey();
  if (!key) return new Response(null, { status: 204 }); // feature off: the UI hides the hint

  const limited = gate(req, HINT_LIMIT);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return bad(`${i.path.join(".") || "body"}: ${i.message}`);
  }
  const b = parsed.data;

  const cacheKey = b.symbol.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return json({ ok: true, hint: hit.hint, cached: true });

  const swing = volatility(b.closes);
  const prompt = [
    `Market: ${b.symbol.split("/")[0]} perpetual.`,
    `24h change: ${(b.change24h * 100).toFixed(2)}%.`,
    `Funding rate: ${(b.fundingRate * 100).toFixed(3)}% per 8h.`,
    swing === null ? "Recent swing: unknown." : `Typical 15-minute swing over the last 12h: ${(swing * 100).toFixed(2)}%.`,
  ].join(" ");

  try {
    const hint = key.startsWith("sk-ant-") ? await askClaude(key, prompt) : await askOpenAi(key, prompt);
    if (!hint) return new Response(null, { status: 204 });
    const trimmed = tidy(hint);
    if (!trimmed) return new Response(null, { status: 204 });
    cache.set(cacheKey, { hint: trimmed, at: Date.now() });
    return json({ ok: true, hint: trimmed });
  } catch {
    // A hint is decoration. If the model is unreachable the card simply has none.
    return new Response(null, { status: 204 });
  }
}

/** Standard deviation of close-to-close returns: how much this market moves in 15 minutes. */
function volatility(closes: number[]): number | null {
  if (closes.length < 4) return null;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
  }
  if (returns.length < 3) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/** One sentence, inside the character budget, or nothing. */
function tidy(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (oneLine.length <= MAX_CHARS) return oneLine;
  // Over budget: keep the first sentence if that fits, otherwise drop the hint rather
  // than cut a sentence about money off mid-word.
  const firstSentence = oneLine.split(/(?<=[.!?])\s/)[0];
  return firstSentence.length <= MAX_CHARS ? firstSentence : "";
}

async function askClaude(apiKey: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  // Server-side fallback is on by default: a policy decline re-runs the same request
  // on a fallback model inside the same call instead of coming back empty.
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 256,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" }, // one short sentence: the cheapest setting that does it
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") return "";
  return response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}

/**
 * OpenAI over raw HTTP rather than its SDK, so a key for a provider this app only
 * tolerates does not add a second SDK to the bundle.
 */
async function askOpenAi(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 256,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) return "";
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}
