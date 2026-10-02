import { z } from "zod";

/**
 * Schemas are the normalization layer: everything entering the policy engine,
 * a commitment, or coming back from the AI passes through here first.
 * Unordered sets are sorted + de-duplicated so commitments are stable.
 */
const sortedUnique = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).transform((xs) => [...new Set(xs)].sort() as z.infer<T>[]);

export const Media = z.enum(["social", "editorial", "advertising", "broadcast", "merchandise", "print", "web", "in_game"]);
export type Media = z.infer<typeof Media>;

/** ISO 3166-1 alpha-2, or WORLD. */
export const Territory = z.string().trim().toUpperCase().regex(/^(?:[A-Z]{2}|WORLD)$/);

export const UseType = z.enum([
  "editorial",
  "social",
  "advertising",
  "merchandising",
  "ai_training",
  "ai_generation",
  "voice_cloning",
  "face_replication",
  "sublicensing",
  "other",
]);
export type UseType = z.infer<typeof UseType>;

export const Currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

/** Integer minor units only. Money is never a float. */
export const MinorUnits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const RightsPolicy = z
  .object({
    version: z.number().int().positive(),
    territory: sortedUnique(Territory).pipe(z.array(z.string()).min(1)),
    media: sortedUnique(Media).pipe(z.array(z.string()).min(1)),
    durationDays: z.number().int().positive().max(36500).optional(),
    commercialUse: z.boolean(),
    aiTraining: z.boolean(),
    aiGeneration: z.boolean(),
    likenessUse: z.boolean(),
    sublicensing: z.boolean(),
    attributionRequired: z.boolean(),
    minimumFeeMinor: MinorUnits.optional(),
    currency: Currency.optional(),
  })
  .strict()
  .refine((p) => (p.minimumFeeMinor === undefined) === (p.currency === undefined), {
    message: "minimumFeeMinor and currency must be set together",
  });
export type RightsPolicy = z.infer<typeof RightsPolicy>;

/** A structured request to use an asset. Produced by a form or by the AI. */
export const UseRequest = z
  .object({
    useType: UseType,
    media: sortedUnique(Media),
    territory: sortedUnique(Territory),
    durationDays: z.number().int().positive().max(36500).optional(),
    commercial: z.boolean(),
    aiTraining: z.boolean(),
    aiGeneration: z.boolean(),
    likeness: z.boolean(),
    sublicensing: z.boolean(),
    attributionOffered: z.boolean().optional(),
    offeredFeeMinor: MinorUnits.optional(),
    currency: Currency.optional(),
  })
  .strict();
export type UseRequest = z.infer<typeof UseRequest>;

/**
 * What the model is allowed to return. Anything else is rejected.
 * The model extracts and explains; it does not decide.
 */
export const AIExtraction = z
  .object({
    request: UseRequest,
    missingInformation: z.array(z.string().max(200)).max(20),
    ambiguities: z.array(z.string().max(300)).max(20),
    explanation: z.string().max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type AIExtraction = z.infer<typeof AIExtraction>;

export const SplitEntry = z
  .object({
    contributorRef: z.string().min(1).max(128),
    role: z.enum(["athlete", "creator", "filmer", "editor", "producer", "agent", "licensor", "other"]),
    bps: z.number().int().positive().max(10000),
  })
  .strict();
export type SplitEntry = z.infer<typeof SplitEntry>;
