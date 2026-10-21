import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

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
    ctx.addIssue({ code: 'custom', message: diagnostic });
  }
});

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'URL must use http:// or https://',
  });

// posts 的每一層物件都用 z.strictObject：沒宣告的 key 讓 build 直接失敗，不會被 Zod 默默
// 丟掉（#1164：頂層 pipeline、scores.全新Eyes 都曾這樣整段消失）。所以這份 schema 就是
// frontmatter 的欄位清單。站內刻意不輸出的欄位用 notRendered() 宣告：照樣驗型別，parse
// 完就丟掉，post.data 與讀者看得到的輸出都不會帶到。
function notRendered<T extends z.ZodType>(schema: T) {
  return schema.transform(() => undefined).optional();
}

const scoreDimension = z.number().int().min(0).max(10);
const retiredClawdNoteKey = z.any().refine(() => false, {
  message: 'Retired score key clawdNote; use moguNote',
});

const stage4ScoresSchema = z.strictObject({
  persona: scoreDimension,
  moguNote: scoreDimension,
  vibe: scoreDimension,
  clarity: scoreDimension.optional(),
  narrative: scoreDimension,
  degradedDimensions: z.array(z.string()).optional(),
  isDegraded: z.boolean(),
  clawdNote: retiredClawdNoteKey.optional(),
});

const librarianScoreSchema = z.strictObject({
  glossary: scoreDimension.optional(),
  crossRef: scoreDimension.optional(),
  sourceAlign: scoreDimension.optional(),
  attribution: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const factCheckScoreSchema = z.strictObject({
  accuracy: scoreDimension.optional(),
  fidelity: scoreDimension.optional(),
  consistency: scoreDimension.optional(),
  sourceBoundary: scoreDimension.optional(),
  commentarySeparation: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const freshEyesScoreSchema = z.strictObject({
  readability: scoreDimension.optional(),
  firstImpression: scoreDimension.optional(),
  payoffDensity: scoreDimension.optional(),
  lengthFit: scoreDimension.optional(),
  clarity: scoreDimension.optional(),
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const vibeScoreSchema = z.strictObject({
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

const legacyRalphScoreSchema = z.strictObject({
  p: scoreDimension,
  c: scoreDimension,
  v: scoreDimension,
  score: scoreDimension,
  date: z.string(),
  model: z.string().optional(),
});

const dedupSchema = z
  .strictObject({
    independentDiff: z.string().optional(),
    acknowledgedOverlapWith: z.array(canonicalTicketId).optional(),
    overlapJustification: z.string().optional(),
    humanOverride: z.boolean().optional(),
    humanOverrideReason: z.string().optional(),
    commentaryAngle: z.string().optional(),
    tribunalVerdict: z
      .strictObject({
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
    .strictObject({
      title: z.string(),
      ticketId: canonicalTicketId, // e.g., "GP-15", "MP-1", "SD-1", "Lv-1"
      originalDate: z.string(), // Original publish date (YYYY-MM-DD format)
      translatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'translatedDate must be YYYY-MM-DD'), // Date we first shipped this post — tribunal sort key (required)
      translatedBy: z
        .strictObject({
          model: z.string(),
          harness: z.string(),
          pipeline: z
            .array(
              z.strictObject({
                role: z.string(), // e.g., "Written", "Reviewed", "Refined"
                provider: z.string().optional(),
                model: z.string(),
                harness: z.string(),
                artifactSha256: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .optional(),
                verdict: z.string().optional(),
              })
            )
            .optional(),
          pipelineUrl: httpUrl.optional(),
        })
        .optional(),
      source: z.string(), // e.g., "@0xdevshah on X"
      sourceUrl: httpUrl,
      author: z.string().optional(), // for original author
      summary: z.string(), // for index page preview
      lang: z.enum(['zh-tw', 'en']).default('zh-tw'),
      tags: z.array(z.string()).optional(),
      // `taken-down`：下架成墓碑頁（openspec: post-takedown）。其他欄位保留，
      // 正文清空；`deprecated`／`retired` 仍是公開全文加狀態標籤。
      status: z.enum(['published', 'deprecated', 'retired', 'taken-down']).default('published'),
      deprecatedBy: canonicalTicketId.optional(),
      deprecatedReason: z.string().optional(),
      retiredReason: z.string().optional(),
      retiredAt: z.string().optional(),
      takenDownAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'takenDownAt must be YYYY-MM-DD')
        .optional(),
      // 來源自己的標題（墓碑卡片第一行）；不得等於 gu-log 自己的標題。
      sourceTitle: z.string().optional(),
      // 來源距離章（openspec source-distance-stamp）：站內沒有程式讀它，不輸出；
      // 內容由 scripts/validate-posts.mjs 驗。
      sourceDistance: notRendered(z.unknown()),
      // 只給 scripts/check-glossary-links.mjs 讀的豁免清單，不輸出。
      glossaryIgnore: notRendered(z.array(z.string())),
      series: z
        .strictObject({
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
        .strictObject({
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
        .strictObject({
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
            .strictObject({
              score: scoreDimension,
              date: z.string(),
              note: z.string().optional(),
            })
            .optional(),
          // 2026-04 四評審上線前 Ralph loop 的舊分數（p／c／v 三維）。網站已不顯示，
          // 舊文保留紀錄；新文章不要再寫。
          ralph: notRendered(legacyRalphScoreSchema),
        })
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.status === 'deprecated' && !data.deprecatedBy) {
        ctx.addIssue({
          code: 'custom',
          message: 'deprecatedBy is required when status is deprecated',
          path: ['deprecatedBy'],
        });
      }
      if (data.status !== 'deprecated' && data.deprecatedBy) {
        ctx.addIssue({
          code: 'custom',
          message: 'status must be deprecated when deprecatedBy is present',
          path: ['status'],
        });
      }
      if (data.status === 'taken-down' && !data.takenDownAt) {
        ctx.addIssue({
          code: 'custom',
          message: 'takenDownAt is required when status is taken-down',
          path: ['takenDownAt'],
        });
      }
      if (data.status === 'taken-down' && !data.sourceTitle?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'sourceTitle is required when status is taken-down',
          path: ['sourceTitle'],
        });
      }
      if (data.status !== 'taken-down' && data.takenDownAt) {
        ctx.addIssue({
          code: 'custom',
          message: 'status must be taken-down when takenDownAt is present',
          path: ['status'],
        });
      }
      if (data.dedup?.humanOverride && !data.dedup.humanOverrideReason?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'dedup.humanOverrideReason is required when humanOverride is true',
          path: ['dedup', 'humanOverrideReason'],
        });
      }
      if (data.dedup?.acknowledgedOverlapWith?.length && !data.dedup.overlapJustification?.trim()) {
        ctx.addIssue({
          code: 'custom',
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
          code: 'custom',
          message: 'proxy author must be distinguishable from authorCanonical',
          path: ['author'],
        });
      }

      const tribunalVersion = data.scores?.tribunalVersion ?? 8;
      if (data.stage4Scores && tribunalVersion >= 9 && data.stage4Scores.clarity != null) {
        ctx.addIssue({
          code: 'custom',
          message: 'stage4Scores.clarity belongs to Fresh Eyes for tribunalVersion >= 9',
          path: ['stage4Scores', 'clarity'],
        });
      }
    })
    .refine(
      (data) => {
        // Every post carries a model signature (translatedBy = model + harness);
        // the post page shows it with the pipeline label of the post's series.
        return !!data.translatedBy;
      },
      {
        message:
          'Every post requires translatedBy (model + harness) — the model signature is mandatory',
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
