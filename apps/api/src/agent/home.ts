import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Media } from "@nextplay/core";

/**
 * Loads the agent's home directory (`agent/`, a Unix-style layout) once at
 * startup. Only fixed, validated paths are read; names from config must be
 * plain slugs, so config can't point the runtime outside the tree. Any
 * invalid file stops the server from starting rather than running half-configured.
 */
export const DEFAULT_AGENT_HOME = resolve(fileURLToPath(new URL("../../../../agent/", import.meta.url)));
const MAX_FILE_BYTES = 32 * 1024;
const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);

export const PIPELINE = ["prescan", "facts", "triage", "think", "repair", "evaluate", "verify", "explain"] as const;
const CODE_TOOLS = ["prescan", "facts", "triage", "repair", "evaluate", "verify", "explain"] as const;
const MODEL_PHASES = ["classify", "plan"] as const;
export type ModelPhase = (typeof MODEL_PHASES)[number];

const Reasoning = z.enum(["off", "low", "medium", "high"]);
const Phase = z
  .object({
    skill: Slug,
    context: z.array(Slug).max(5),
    reasoning: Reasoning,
    maxTokens: z.number().int().min(64).max(4096),
    maxReadings: z.number().int().min(1).max(3).optional(),
  })
  .strict();
const Config = z
  .object({
    version: z.literal(1),
    pipeline: z.array(z.string()),
    loop: z
      .object({
        maxIterations: z.number().int().min(1).max(3),
        minConfidence: z.number().min(0).max(1),
        escalateOnRepair: z.boolean(),
      })
      .strict(),
    phases: z.object({ classify: Phase, plan: Phase }).strict(),
  })
  .strict();
export const TIERS = ["light", "standard", "heavy"] as const;
export type Tier = (typeof TIERS)[number];
const TierSpec = z
  .object({
    model: z.string().regex(/^[\w./-]{3,120}$/),
    inputPerM: z.number().nonnegative().max(100),
    outputPerM: z.number().nonnegative().max(100),
  })
  .strict();
const Models = z
  .object({
    version: z.literal(1),
    note: z.string().optional(),
    tiers: z.object({ light: TierSpec, standard: TierSpec, heavy: TierSpec }).strict(),
    routing: z
      .object({
        classify: z.enum(TIERS),
        plan: z.enum(TIERS),
        heavyAtWorkload: z.number().int().min(1).max(20),
        heavyEnabled: z.boolean(),
        /** Hard cap on heavy-tier calls per UTC day, so keyword stuffing can't drain credit on the priciest model. */
        heavyMaxPerDay: z.number().int().min(0).max(10_000),
        escalateOnFailure: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ModelsConfig = z.infer<typeof Models>;

const Tool = z
  .object({
    name: Slug,
    kind: z.enum(["code", "model"]),
    summary: z.string().max(400),
    reads: z.array(z.string().max(120)),
    tokens: z.union([z.literal(0), z.string().max(80)]),
  })
  .strict();

const Pattern = z.string().max(600);
const Money = z
  .object({
    note: z.string().optional(),
    codes: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
    symbols: z.record(z.string().max(3), z.string().regex(/^[A-Z]{3}$/)),
    thousandSuffixes: z.array(z.string().regex(/^[a-z]+$/)),
  })
  .strict();
const Durations = z
  .object({
    numberWords: z.record(z.string().regex(/^[a-z]+$/), z.number().int().positive()),
    unitDays: z.record(z.string().regex(/^[a-z]+$/), z.number().int().positive()),
    perpetual: Pattern,
    /** Renewal / extension wording: the real length may exceed the stated one. */
    extension: Pattern,
    maxDays: z.number().int().positive().max(36500),
  })
  .strict();
const Channels = z.object({ note: z.string().optional(), channels: z.record(Media, Pattern) }).strict();
const Countries = z
  .object({
    note: z.string().optional(),
    names: z.record(z.string().regex(/^(?:[A-Z]{2}|WORLD)$/), Pattern),
    codes: z.record(z.string().regex(/^[A-Z]{2}$/), Pattern),
  })
  .strict();
const Credit = z.object({ offered: Pattern }).strict();
const Triage = z.object({ note: z.string().optional(), deepIf: z.array(Pattern).min(1).max(30) }).strict();

export interface FactTables {
  money: z.infer<typeof Money>;
  numberWords: Record<string, number>;
  unitDays: Record<string, number>;
  perpetual: RegExp;
  extension: RegExp;
  maxDays: number;
  channels: Array<[Media, RegExp]>;
  /** Country names, case-insensitive. */
  countries: Array<[string, RegExp]>;
  /** Short codes (US, UK), case-sensitive; skipped for mostly-capitals text. */
  countryCodes: Array<[string, RegExp]>;
  credit: RegExp;
}

export interface AgentHome {
  root: string;
  config: z.infer<typeof Config>;
  models: ModelsConfig;
  tools: Record<string, z.infer<typeof Tool>>;
  /** System prompt per model phase: skill + context files. */
  prompts: Record<ModelPhase, string>;
  facts: FactTables;
  triage: RegExp[];
}

function read(root: string, rel: string): string {
  const path = join(root, rel);
  if (!path.startsWith(root)) throw new Error(`agent home: path escapes the tree: ${rel}`);
  const size = statSync(path).size;
  if (size > MAX_FILE_BYTES) throw new Error(`agent home: ${rel} is larger than ${MAX_FILE_BYTES} bytes`);
  return readFileSync(path, "utf8");
}

function json<T>(root: string, rel: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(JSON.parse(read(root, rel)));
  if (!parsed.success) throw new Error(`agent home: ${rel} is invalid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

function regex(src: string, flags: string, where: string): RegExp {
  try {
    return new RegExp(src, flags);
  } catch {
    throw new Error(`agent home: bad pattern in ${where}`);
  }
}

export function loadAgentHome(root: string = DEFAULT_AGENT_HOME): AgentHome {
  const base = resolve(root);
  const config = json(base, "etc/agent.json", Config);
  if (config.pipeline.join(",") !== PIPELINE.join(",")) {
    throw new Error(`agent home: etc/agent.json pipeline must be ${PIPELINE.join(" → ")}`);
  }

  const models = json(base, "etc/models.json", Models);

  const tools: AgentHome["tools"] = {};
  for (const name of [...CODE_TOOLS, ...MODEL_PHASES]) {
    const tool = json(base, `bin/${name}.json`, Tool);
    if (tool.name !== name) throw new Error(`agent home: bin/${name}.json names itself "${tool.name}"`);
    tools[name] = tool;
  }

  const prompts = {} as Record<ModelPhase, string>;
  for (const phase of MODEL_PHASES) {
    const p = config.phases[phase];
    const parts = [read(base, `skills/${p.skill}.md`), ...p.context.map((c) => read(base, `share/context/${c}.md`))];
    prompts[phase] = parts.map((s) => s.trim()).join("\n");
  }

  const money = json(base, "share/data/money.json", Money);
  const durations = json(base, "share/data/durations.json", Durations);
  const channels = json(base, "share/data/channels.json", Channels);
  const countries = json(base, "share/data/countries.json", Countries);
  const credit = json(base, "share/data/credit.json", Credit);
  const triage = json(base, "share/data/triage.json", Triage);

  return {
    root: base,
    config,
    models,
    tools,
    prompts,
    facts: {
      money,
      numberWords: durations.numberWords,
      unitDays: durations.unitDays,
      perpetual: regex(durations.perpetual, "i", "durations.json"),
      extension: regex(durations.extension, "i", "durations.json extension"),
      maxDays: durations.maxDays,
      channels: (Object.entries(channels.channels) as Array<[Media, string]>).map(([m, src]) => [m, regex(src, "i", `channels.json ${m}`)]),
      countries: Object.entries(countries.names).map(([c, src]): [string, RegExp] => [c, regex(src, "i", `countries.json ${c}`)]),
      // Codes are case-sensitive on purpose (see the note in countries.json).
      countryCodes: Object.entries(countries.codes).map(([c, src]): [string, RegExp] => [c, regex(src, "", `countries.json ${c}`)]),
      credit: regex(credit.offered, "i", "credit.json"),
    },
    triage: triage.deepIf.map((src, i) => regex(src, "i", `triage.json #${i}`)),
  };
}
