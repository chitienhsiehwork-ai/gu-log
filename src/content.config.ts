import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const CANONICAL_TICKET_PATTERN = /^(GP|MP|SD|Lv)-(\d+|PENDING)$/;
const RETIRED_TICKET_PATTERN = /^(SP|CP)-(\d+|PENDING)$/;

function canonicalTicketDiagnostic(value: string): string | null {
  const retired = value.match(RETIRED_TICKET_PATTERN);
  if (retired) {
    const replacement = retired[1] === 'SP' ? 'GP' : 'MP';
    return `Retired ticketId ${value}; use ${replacement}-${retired[2]}`;
  }
  if (!CANONICAL_TICKET_PATTERN.test(value)) {
    return `Invalid ticketId ${value}; expected GP-N, MP-N, SD-N, Lv-N, or *-PENDING`;
  }
  return null;
}

const canonicalTicketId = z.string().superRefine((value, ctx) => {
  const diagnostic = canonicalTicketDiagnostic(value);
  if (diagnostic) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: diagnostic });
  }
});

const scoreDimension = z.number().int().min(0).max(10);
const retiredClawdNoteKey = z.any().refine(() => false, {
  message: 'Retired score key clawdNote; use moguNote',
});

const stage4ScoresSchema = z.object({
  persona: scoreDimension,
  moguNote: scoreDimension,
  vibe: scoreDimension,
  clarity: scoreDimension.optional(),
  narrative: scoreDimension,
  degradedDimensions: z.array(z.string()).optional(),
  isDegraded: z.boolean(),
  clawdNote: retiredClawdNoteKey.optional(),
});

const librarianScoreSchema = z.object({
  glossary: scoreDimension.optional(),
  crossRef: scoreDimension.optional(),
  sourceAlign: scoreDimension.optional(),
  attribution: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const factCheckScoreSchema = z.object({
  accuracy: scoreDimension.optional(),
  fidelity: scoreDimension.optional(),
  consistency: scoreDimension.optional(),
  sourceBoundary: scoreDimension.optional(),
  commentarySeparation: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const freshEyesScoreSchema = z.object({
  readability: scoreDimension.optional(),
  firstImpression: scoreDimension.optional(),
  payoffDensity: scoreDimension.optional(),
  lengthFit: scoreDimension.optional(),
  clarity: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const vibeScoreSchema = z.object({
  persona: scoreDimension.optional(),
  moguNote: scoreDimension.optional(),
  vibe: scoreDimension.optional(),
  clarity: scoreDimension.optional(),
  narrative: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
  clawdNote: retiredClawdNoteKey.optional(),
});

const dedupSchema = z
  .object({
    independentDiff: z.string().optional(),
    acknowledgedOverlapWith: z.array(canonicalTicketId).optional(),
    overlapJustification: z.string().optional(),
    humanOverride: z.boolean().optional(),
    humanOverrideReason: z.string().optional(),
    commentaryAngle: z.string().optional(),
    tribunalVerdict: z
      .object({
        class: z.string().optional(),
        action: z.string().optional(),
        matchedSlugs: z.array(z.string()).optional(),
        score: scoreDimension.optional(),
        reason: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const postsCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/posts' }),
  schema: z
    .object({
      title: z.string(),
      ticketId: canonicalTicketId, // e.g., "GP-15", "MP-1", "SD-1", "Lv-1"
      originalDate: z.string(), // Original publish date (YYYY-MM-DD format)
      translatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'translatedDate must be YYYY-MM-DD'), // Date we first shipped this post — tribunal sort key (required)
      translatedBy: z
        .object({
          model: z.string(),
          harness: z.string(),
          pipeline: z
            .array(
              z.object({
                role: z.string(), // e.g., "Written", "Reviewed", "Refined"
                model: z.string(),
                harness: z.string(),
              })
            )
            .optional(),
          pipelineUrl: z.string().url().optional(),
        })
        .optional(),
      source: z.string(), // e.g., "@0xdevshah on X"
      sourceUrl: z.string().url(),
      author: z.string().optional(), // for original author
      summary: z.string(), // for index page preview
      lang: z.enum(['zh-tw', 'en']).default('zh-tw'),
      tags: z.array(z.string()).optional(),
      status: z.enum(['published', 'deprecated', 'retired']).default('published'),
      deprecatedBy: canonicalTicketId.optional(),
      deprecatedReason: z.string().optional(),
      retiredReason: z.string().optional(),
      retiredAt: z.string().optional(),
      series: z
        .object({
          name: z.string(),
          order: z.number(),
        })
        .optional(),
      // Extended taxonomy fields are intentionally optional during the
      // staged corpus migration. Their types are already enforced whenever
      // present; the later migration gate removes `.optional()` atomically.
      sourceType: z.enum(['primary', 'derivative', 'commentary']).optional(),
      temporalType: z.enum(['event', 'evergreen', 'hybrid']).optional(),
      authorCanonical: z.string().min(1).optional(),
      authorType: z.enum(['individual', 'org', 'proxy']).optional(),
      clusterIds: z.array(z.string()).optional(),
      seriesId: z.string().optional(),
      dedup: dedupSchema,
      metadata: z
        .object({
          gateWarnings: z.array(z.string()).optional(),
        })
        .optional(),
      // Tribunal v2: Stage 0 Worthiness Gate
      warnedByStage0: z.boolean().optional().default(false),
      warnReason: z.string().max(150).optional(), // reader_friendly_reason (150 char cap per Q5 decision)
      warnOverrideComment: z.string().optional(), // ShroomDog override explanation

      // Tribunal v2: Stage 4 Final Vibe regression tracking
      stage4Scores: stage4ScoresSchema.optional(),

      scores: z
        .object({
          // Tribunal version — tracks which scoring rubric was used
          tribunalVersion: z.number().int().positive().optional(),
          // Tribunal judges — uniform: all dims 0-10, score = floor(avg)
          librarian: librarianScoreSchema.optional(),
          factCheck: factCheckScoreSchema.optional(),
          freshEyes: freshEyesScoreSchema.optional(),
          vibe: vibeScoreSchema.optional(),
          // ShroomDog's own vibe score — the named human editor's read,
          // recorded alongside the AI tribunal. Editorial ground truth /
          // calibration signal against the machine vibe score; not a commit gate.
          shroomDogVibe: z
            .object({
              score: scoreDimension,
              date: z.string(),
              note: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.status === 'deprecated' && !data.deprecatedBy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'deprecatedBy is required when status is deprecated',
          path: ['deprecatedBy'],
        });
      }
      if (data.status !== 'deprecated' && data.deprecatedBy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'status must be deprecated when deprecatedBy is present',
          path: ['status'],
        });
      }
      if (data.dedup?.humanOverride && !data.dedup.humanOverrideReason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dedup.humanOverrideReason is required when humanOverride is true',
          path: ['dedup', 'humanOverrideReason'],
        });
      }
      if (data.dedup?.acknowledgedOverlapWith?.length && !data.dedup.overlapJustification?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dedup.overlapJustification is required for acknowledged overlaps',
          path: ['dedup', 'overlapJustification'],
        });
      }
      if (
        data.authorType === 'proxy' &&
        data.author != null &&
        data.authorCanonical != null &&
        data.author === data.authorCanonical
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'proxy author must be distinguishable from authorCanonical',
          path: ['author'],
        });
      }

      const tribunalVersion = data.scores?.tribunalVersion ?? 8;
      if (data.stage4Scores && tribunalVersion >= 9 && data.stage4Scores.clarity != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'stage4Scores.clarity belongs to Fresh Eyes for tribunalVersion >= 9',
          path: ['stage4Scores', 'clarity'],
        });
      }
    })
    .refine(
      (data) => {
        // Every post carries a model signature (translatedBy = model + harness).
        // GP/MP translations render it as "translated by"; SD/Lv originals render
        // it as "written by" (post page picks wording by ticketId prefix).
        return !!data.translatedBy;
      },
      {
        message:
          'Every post requires translatedBy (model + harness) — the model signature is mandatory (translations: "translated by", originals: "written by")',
        path: ['translatedBy'],
      }
    ),
});

const briefsCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/briefs' }),
  schema: z.object({
    title: z.string(),
    briefType: z.enum(['morning', 'late-night', 'patrol']),
    date: z.string(), // YYYY-MM-DD
    time: z.string(), // e.g., "09:00 台北"
    summary: z.string(),
    lang: z.enum(['zh-tw', 'en']).default('zh-tw'),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = {
  posts: postsCollection,
  briefs: briefsCollection,
};
