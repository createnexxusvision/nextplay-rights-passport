import { normalizeForScan, type Media, type ModelRequest, type UseRequest } from "@nextplay/core";
import type { FactTables } from "./home.js";

/**
 * `bin/facts` — deterministic extraction of what plain text states
 * unambiguously: money, duration, channels, countries, credit. Tables live in
 * `agent/share/data/`. Zero tokens, same answer every time, and a fee or
 * duration the text doesn't contain can never appear.
 */
export interface RequestFacts {
  fee?: { offeredFeeMinor: number; currency: string };
  durationDays?: number;
  media: Media[];
  territory: string[];
  attributionOffered?: true;
  /** Things the text states more than one way. Each one forces human review. */
  conflicts: string[];
}

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toMinor(whole: string, cents: string | undefined, thousands: boolean): number {
  const minor = Number(whole.replace(/,/g, "")) * 100 + (cents ? Number(cents.padEnd(2, "0")) : 0);
  return thousands ? minor * 1000 : minor;
}

function fees(text: string, t: FactTables): Array<{ offeredFeeMinor: number; currency: string }> {
  const codes = t.money.codes.join("|");
  const symbols = Object.keys(t.money.symbols).map(escape).join("");
  const k = `(?:\\s*(${t.money.thousandSuffixes.join("|")}))?\\b`;
  const found: Array<{ offeredFeeMinor: number; currency: string }> = [];
  const push = (whole: string, cents: string | undefined, kk: string | undefined, currency: string) =>
    found.push({ offeredFeeMinor: toMinor(whole, cents, Boolean(kk)), currency });

  for (const m of text.matchAll(new RegExp(`([${symbols}])\\s?${AMOUNT}${k}`, "gi"))) push(m[2]!, m[3], m[4], t.money.symbols[m[1]!]!);
  for (const m of text.matchAll(new RegExp(`\\b(${codes})\\s?${AMOUNT}${k}`, "g"))) push(m[2]!, m[3], m[4], m[1]!);
  for (const m of text.matchAll(new RegExp(`(?<![${symbols}\\d,.])${AMOUNT}${k}\\s?(${codes})\\b`, "g"))) push(m[1]!, m[2], m[3], m[4]!);
  return found;
}

function durations(text: string, t: FactTables): number[] {
  const words = Object.keys(t.numberWords).join("|");
  const units = Object.keys(t.unitDays).join("|");
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,5}|${words})[\\s-]*(${units})s?\\b`, "gi"))) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : t.numberWords[m[1]!.toLowerCase()]!;
    out.push(Math.min(n * t.unitDays[m[2]!.toLowerCase()]!, t.maxDays));
  }
  if (t.perpetual.test(text)) out.push(t.maxDays);
  return out;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function extractRequestFacts(rawText: string, t: FactTables): RequestFacts {
  const text = normalizeForScan(rawText);
  const conflicts: string[] = [];
  const facts: RequestFacts = { media: [], territory: [], conflicts };

  const feeKeys = uniq(fees(text, t).map((f) => `${f.offeredFeeMinor} ${f.currency}`));
  if (feeKeys.length === 1) {
    const [minor, currency] = feeKeys[0]!.split(" ");
    facts.fee = { offeredFeeMinor: Number(minor), currency: currency! };
  } else if (feeKeys.length > 1) conflicts.push("The request states more than one fee.");

  const days = uniq(durations(text, t));
  if (days.length === 1) facts.durationDays = days[0]!;
  else if (days.length > 1) conflicts.push("The request states more than one duration.");

  facts.media = t.channels.filter(([, re]) => re.test(text)).map(([m]) => m).sort();
  facts.territory = uniq(t.countries.filter(([, re]) => re.test(text)).map(([c]) => c)).sort();
  if (t.credit.test(text)) facts.attributionOffered = true;
  return facts;
}

/**
 * Code wins wherever it found something. Fee and duration are ONLY ever taken
 * from the text, never from the model. Channels and countries fall back to the
 * model when code found none, to cover phrasings the tables don't know.
 */
export function mergeRequest(model: ModelRequest, facts: RequestFacts): UseRequest {
  return {
    ...model,
    media: facts.media.length ? facts.media : model.media,
    territory: facts.territory.length ? facts.territory : model.territory,
    ...(facts.durationDays !== undefined ? { durationDays: facts.durationDays } : {}),
    ...(facts.fee ?? {}),
    ...(facts.attributionOffered ? { attributionOffered: true } : {}),
  };
}
