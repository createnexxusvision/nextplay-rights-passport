/**
 * Deterministic prompt-injection pre-scan for free-text use requests.
 *
 * The requester writes the text the AI reads, so the text is adversarial by
 * default. This scan runs BEFORE the model and never depends on it: a hit
 * forces NEEDS_REVIEW (and skips the model call entirely). It is a tripwire,
 * not a filter — false positives only cost a human look, never an approval.
 *
 * Input is NFKC-normalized and stripped of zero-width / bidi control
 * characters first, so look-alike and invisible-character tricks still match.
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
];

export interface InjectionScan {
  suspected: boolean;
  /** Names of the patterns that matched. Safe to log; never contains user text. */
  matches: string[];
}

export function normalizeForScan(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

export function scanForInjection(text: string): InjectionScan {
  const t = normalizeForScan(text);
  const matches = PATTERNS.filter(([, re]) => re.test(t)).map(([name]) => name);
  return { suspected: matches.length > 0, matches };
}
