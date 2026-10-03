import type { Media, UseRequest } from "./schemas.js";
import { normalizeForScan } from "./injection.js";

/**
 * Deterministic extraction of the request facts that plain text states
 * unambiguously: money, duration, channels, countries, credit.
 *
 * These never go to the model. Code reads them the same way every time, at no
 * token cost, and a number the text doesn't contain can never appear (a model
 * without reasoning was observed inventing `durationDays: 365`). The model
 * only answers the judgement calls (use type, commercial, likeness, AI use).
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

// Two-decimal currencies only, so "minor units" is always ×100.
const CODES = ["USD", "GBP", "EUR", "CAD", "AUD", "CHF", "NZD", "MXN", "BRL", "INR"] as const;
const SYMBOL: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR" };
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|thousand)?\b`;
const CODE_RE = CODES.join("|");

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const PERPETUAL = /\b(?:perpetual(?:ly)?|in perpetuity|forever|indefinite(?:ly)?|no end date)\b/i;
const MAX_DAYS = 36500;

const MEDIA_KEYWORDS: Array<[Media, RegExp]> = [
  ["social", /\b(?:social(?:\s+media)?|instagram|insta|tiktok|facebook|twitter|threads|snapchat|youtube|reels?)\b/i],
  ["web", /\b(?:website|web\s*site|web|online|blog|landing\s+page)\b/i],
  ["advertising", /\b(?:ads?|advert(?:isement|ising)?s?|billboards?|sponsored|commercials)\b/i],
  ["broadcast", /\b(?:tv|television|broadcast|streaming\s+service|radio)\b|\btv\s+commercial\b/i],
  ["print", /\b(?:print|magazine|newspaper|posters?|flyers?|brochures?)\b/i],
  ["merchandise", /\b(?:merch(?:andise)?|t-?shirts?|jerseys?|apparel|hoodies?|mugs?)\b/i],
  ["editorial", /\b(?:editorial|news\s+(?:story|article|coverage)|journalism)\b/i],
  ["in_game", /\b(?:in-?game|video\s+games?|esports?)\b/i],
];

// Country names are matched case-insensitively; short codes only in capitals,
// so "us" (the pronoun) never reads as the United States.
const COUNTRY_NAMES: Array<[string, RegExp]> = [
  ["WORLD", /\b(?:worldwide|world-?wide|global(?:ly)?|international(?:ly)?|all\s+countries|every\s+country)\b/i],
  // Not "American": "American football" is a sport, not a territory.
  ["US", /\b(?:united\s+states|america)\b/i],
  ["GB", /\b(?:united\s+kingdom|britain|british|england|scotland|wales)\b/i],
  ["CA", /\b(?:canada|canadian)\b/i],
  ["MX", /\b(?:mexico|mexican)\b/i],
  ["DE", /\b(?:germany|german)\b/i],
  ["FR", /\b(?:france|french)\b/i],
  ["ES", /\b(?:spain|spanish)\b/i],
  ["IT", /\b(?:italy|italian)\b/i],
  ["IE", /\b(?:ireland|irish)\b/i],
  ["NL", /\b(?:netherlands|dutch)\b/i],
  ["JP", /\b(?:japan|japanese)\b/i],
  ["AU", /\b(?:australia|australian)\b/i],
  ["BR", /\b(?:brazil|brazilian)\b/i],
  ["IN", /\b(?:india)\b/i],
];
const COUNTRY_CODES: Array<[string, RegExp]> = [
  ["US", /\b(?:US|USA|U\.S\.(?:A\.)?)(?![A-Za-z])/],
  ["GB", /\b(?:UK|U\.K\.|GB)(?![A-Za-z])/],
];

const CREDIT = /\b(?:credit(?:ing|ed)?|attribut(?:e|ion|ed|ing)|tag(?:ging)?\s+(?:the\s+)?(?:athlete|creator|player)|shout-?out)\b/i;

function toMinor(whole: string, cents: string | undefined, k: string | undefined): number {
  const units = Number(whole.replace(/,/g, ""));
  const minor = units * 100 + (cents ? Number(cents.padEnd(2, "0")) : 0);
  return k ? minor * 1000 : minor;
}

function fees(text: string): Array<{ offeredFeeMinor: number; currency: string }> {
  const found: Array<{ offeredFeeMinor: number; currency: string }> = [];
  const patterns: Array<[RegExp, (m: RegExpExecArray) => string]> = [
    [new RegExp(String.raw`([$£€])\s?${AMOUNT}`, "gi"), (m) => SYMBOL[m[1]!]!],
    [new RegExp(String.raw`\b(${CODE_RE})\s?${AMOUNT}`, "g"), (m) => m[1]!],
    [new RegExp(String.raw`(?<![$£€\d,.])${AMOUNT}\s?(${CODE_RE})\b`, "g"), (m) => m[4]!],
  ];
  for (const [re, currencyOf] of patterns) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const [whole, cents, k] = re.source.startsWith("(?<!") ? [m[1]!, m[2], m[3]] : [m[2]!, m[3], m[4]];
      found.push({ offeredFeeMinor: toMinor(whole, cents, k), currency: currencyOf(m) });
    }
  }
  return found;
}

function durations(text: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{1,5}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]*(day|week|month|year)s?\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!.toLowerCase()]!;
    out.push(Math.min(n * UNIT_DAYS[m[2]!.toLowerCase()]!, MAX_DAYS));
  }
  if (PERPETUAL.test(text)) out.push(MAX_DAYS);
  return out;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function extractRequestFacts(rawText: string): RequestFacts {
  const text = normalizeForScan(rawText);
  const conflicts: string[] = [];
  const facts: RequestFacts = { media: [], territory: [], conflicts };

  const feeKeys = uniq(fees(text).map((f) => `${f.offeredFeeMinor} ${f.currency}`));
  if (feeKeys.length === 1) {
    const [minor, currency] = feeKeys[0]!.split(" ");
    facts.fee = { offeredFeeMinor: Number(minor), currency: currency! };
  } else if (feeKeys.length > 1) conflicts.push("The request states more than one fee.");

  const days = uniq(durations(text));
  if (days.length === 1) facts.durationDays = days[0]!;
  else if (days.length > 1) conflicts.push("The request states more than one duration.");

  facts.media = MEDIA_KEYWORDS.filter(([, re]) => re.test(text)).map(([m]) => m).sort();
  facts.territory = uniq([...COUNTRY_NAMES, ...COUNTRY_CODES].filter(([, re]) => re.test(text)).map(([c]) => c)).sort();
  if (CREDIT.test(text)) facts.attributionOffered = true;
  return facts;
}

/** The fields the model is still asked for: judgement calls, plus fallbacks. */
export type ModelRequest = Pick<
  UseRequest,
  "useType" | "media" | "territory" | "commercial" | "aiTraining" | "aiGeneration" | "likeness" | "sublicensing"
>;

/**
 * Combine model judgement with deterministic facts. Code wins wherever it found
 * something. Fee and duration are ONLY ever taken from the text, never from the
 * model. Channels and countries fall back to the model when code found none,
 * to cover phrasings the keyword lists don't know.
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
