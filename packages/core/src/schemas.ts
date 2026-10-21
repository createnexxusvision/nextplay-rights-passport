import { z } from "zod";

/**
 * Schemas are the normalization layer: everything entering the policy engine,
 * a commitment, or coming back from the AI passes through here first.
 * Unordered sets are sorted + de-duplicated so commitments are stable.
 */
/**
 * Free text is NFC-normalized (S11): "é" typed as one code point or as
 * "e" + combining accent must canonicalize — and hash — identically.
 */
export const text = (max: number, min = 0) => z.string().min(min).max(max).transform((s) => s.normalize("NFC"));

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

/**
 * What the owner actually holds in this asset (rights layering). Game footage
 * is often owned by a school, league or broadcaster while the athlete controls
 * only their name, image and likeness (NIL). Optional: absent = "original",
 * so policies sealed before this field existed keep the same commitment.
 *  original     — I created it or own the content outright
 *  licensed     — I hold a license from the content owner
 *  likeness_only — someone else owns the content; I control my NIL in it
 */
export const ClaimBasis = z.enum(["original", "licensed", "likeness_only"]);
export type ClaimBasis = z.infer<typeof ClaimBasis>;

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
    claimBasis: ClaimBasis.optional(),
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
    missingInformation: z.array(text(200)).max(20),
    ambiguities: z.array(text(300)).max(20),
    explanation: text(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type AIExtraction = z.infer<typeof AIExtraction>;

/**
 * One reading of a request as the model sees it: only the judgement calls,
 * plus channel and country as fallbacks. Fee, duration and credit are read
 * from the text by code; the explanation is written by `describeUseRequest()`.
 */
export const ModelRequest = z
  .object({
    useType: UseType,
    media: sortedUnique(Media),
    territory: sortedUnique(Territory),
    commercial: z.boolean(),
    aiTraining: z.boolean(),
    aiGeneration: z.boolean(),
    likeness: z.boolean(),
    sublicensing: z.boolean(),
  })
  .strict();
export type ModelRequest = z.infer<typeof ModelRequest>;

/** Fast path (`classify`): one reading. */
export const AIModelOutput = z.object({ request: ModelRequest, confidence: z.number().min(0).max(1) }).strict();
export type AIModelOutput = z.infer<typeof AIModelOutput>;

/** Deep path (`plan`): up to 3 plausible readings, most likely first. */
export const AIPlanOutput = z
  .object({ readings: z.array(ModelRequest).min(1).max(3), confidence: z.number().min(0).max(1) })
  .strict();
export type AIPlanOutput = z.infer<typeof AIPlanOutput>;

export const SplitEntry = z
  .object({
    contributorRef: text(128, 1),
    role: z.enum(["athlete", "creator", "filmer", "editor", "producer", "agent", "licensor", "other"]),
    bps: z.number().int().positive().max(10000),
  })
  .strict();
export type SplitEntry = z.infer<typeof SplitEntry>;
