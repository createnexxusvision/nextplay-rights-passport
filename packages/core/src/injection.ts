/**
 * Deterministic prompt-injection pre-scan for free-text use requests.
 *
 * The requester writes the text the AI reads, so the text is adversarial by
 * default. This scan runs BEFORE the model and never depends on it: a hit
 * forces NEEDS_REVIEW (and skips the model call entirely). It is a tripwire,
 * not a filter — false positives only cost a human look, never an approval.
 *
 * Input is NFKC-normalized and stripped of zero-width / bidi control
 * characters first. It is then scanned in several "views" so common evasions
 * still match: Cyrillic/Greek look-alike letters folded to Latin, leetspeak
 * undone (1gn0re → ignore), spaced-out letters joined (i g n o r e), and
 * base64 blobs decoded. Patterns cover English plus Spanish, French,
 * Portuguese, German and Italian, instructions aimed at the model ("the
 * classifier should output…") and pasted field assignments (commercial=false).
 *
 * This is defence in depth, not the defence: the model never sees the policy,
 * fee and duration are read by code, repairs only add caution, and an
 * AI-read ALLOWED must be confirmed as structured terms before it is signed.
 */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

const PATTERNS: Array<[name: string, re: RegExp]> = [
  ["ignore_instructions", /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|the|your|these|those)\b[^.\n]{0,40}\b(?:instructions?|rules?|prompts?|directions?|guidelines?|polic(?:y|ies)|constraints?)\b/i],
  ["system_prompt", /\bsystem[\s_-]*(?:prompt|message|instructions?)\b/i],
  ["role_reassignment", /\byou\s+are\s+(?:now|no\s+longer)\b|\bact\s+as\s+(?:an?\s+)?(?:admin|administrator|developer|system|approver)\b|\bpretend\s+(?:to\s+be|you\s+are)\b/i],
  ["new_instructions", /\b(?:new|updated|real|actual)\s+instructions?\s*:/i],
  ["mode_switch", /\b(?:developer|dev|god|jailbreak|dan|admin)\s+mode\b/i],
  ["role_tag", /<\|?\/?\s*(?:system|assistant|user|developer|im_start|im_end|endoftext)\s*\|?>|\[\/?(?:INST|SYS)\]|<<\/?SYS>>/i],
  ["role_prefix", /(?:^|\n)\s*(?:system|assistant|developer)\s*:/i],
  ["force_decision", /\b(?:mark|set|return|output|respond|classify)\b[^.\n]{0,30}\b(?:as\s+)?(?:approved|allowed|confidence\s*[:=]?\s*1(?:\.0+)?)\b/i],
  // Spanish, French, Portuguese, German, Italian: "ignore (all) previous instructions / rules".
  ["ignore_instructions_intl", /\b(?:ignor[ae]r?|ignorez|ignoriere|olvid[ae]r?|oublie[zr]?|vergiss|desconsider[ae]r?|ignorare)\b[^.\n]{0,60}\b(?:instrucci[oó]n(?:es)?|instru[cç](?:[õo]es|tions?)|anweisungen|regeln|istruzioni|regole|reglas|regras|r[èe]gles|consignes)\b/i],
  // Instructions addressed to the model rather than describing a use.
  ["model_directed", /\b(?:the\s+)?(?:classifier|model|ai|llm|assistant|parser|extractor|system)\b[^.\n]{0,40}\b(?:should|must|will|needs?\s+to|has\s+to|is\s+to)\b[^.\n]{0,30}\b(?:output|return|set|mark|classify|label|answer|respond\s+with)\b/i],
  // Pasted schema fields: commercial=false, "likeness": false, confidence: 1 ...
  ["field_assignment", /["']?\b(?:commercial|likeness|aiTraining|aiGeneration|sublicensing|confidence|useType|decision|territory|media)\b["']?\s*[:=]\s*(?:true|false|\d|["'\[])/i],
];

// Latin look-alikes from Cyrillic and Greek, folded before matching.
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ӏ: "l",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", І: "I", Ј: "J", Ѕ: "S",
  α: "a", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i", "|": "l" };

const fold = (t: string) => t.replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c);
const unleet = (t: string) => t.replace(/[013457@$!|]/g, (c) => LEET[c] ?? c);
/** "i g n o r e" / "i.g.n.o.r.e" / "i-g-n-o-r-e" → "ignore" */
const despace = (t: string) => t.replace(/\b(?:[a-z][\s.\-_*]){3,}[a-z]\b/gi, (m) => m.replace(/[\s.\-_*]/g, ""));

/** Decode base64-looking blobs that turn out to be readable text, so encoded instructions are scanned too. */
function decodedBlobs(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    try {
      const decoded = atob(m[0]);
      if (/^[\x20-\x7e\s]{12,}$/.test(decoded)) out.push(decoded);
    } catch {
      /* not base64 */
    }
    if (out.length >= 5) break;
  }
  return out;
}

export interface InjectionScan {
  suspected: boolean;
  /** Names of the patterns that matched. Safe to log; never contains user text. */
  matches: string[];
}

export function normalizeForScan(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

export function scanForInjection(text: string): InjectionScan {
  const base = fold(normalizeForScan(text));
  const views = [base, unleet(base), despace(base), despace(unleet(base))];
  const blobs = decodedBlobs(base);
  const hits = new Set<string>();
  for (const v of [...views, ...blobs]) for (const [name, re] of PATTERNS) if (re.test(v)) hits.add(name);
  // Any readable instruction hidden in an encoded blob is itself a signal.
  if (blobs.some((b) => PATTERNS.some(([, re]) => re.test(b)))) hits.add("encoded_payload");
  const matches = [...hits];
  return { suspected: matches.length > 0, matches };
}
