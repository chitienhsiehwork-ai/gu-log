import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: z
    .object({
      title: z.string(),
      ticketId: z.string().optional(), // e.g., "SP-15", "CP-1", "SD-1", "Lv-1"
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
              }),
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
      deprecatedBy: z.string().optional(),
      deprecatedReason: z.string().optional(),
      retiredReason: z.string().optional(),
      retiredAt: z.string().optional(),
      series: z
        .object({
          name: z.string(),
          order: z.number(),
        })
        .optional(),
      // Tribunal v2: Stage 0 Worthiness Gate
      warnedByStage0: z.boolean().optional().default(false),
      warnReason: z.string().max(150).optional(), // reader_friendly_reason (150 char cap per Q5 decision)
      warnOverrideComment: z.string().optional(), // ShroomDog override explanation

      // Tribunal v2: Stage 4 Final Vibe regression tracking
      stage4Scores: z
        .object({
          persona: z.number().min(0).max(10),
          clawdNote: z.number().min(0).max(10),
          vibe: z.number().min(0).max(10),
          clarity: z.number().min(0).max(10),
          narrative: z.number().min(0).max(10),
          degradedDimensions: z.array(z.string()).optional(),
          isDegraded: z.boolean(),
        })
        .optional(),

      scores: z
        .object({
          // Tribunal version — tracks which scoring rubric was used
          tribunalVersion: z.number().min(1).optional(),
          // Tribunal judges — uniform: all dims 0-10, score = floor(avg)
          librarian: z
            .object({
              glossary: z.number().min(0).max(10).optional(),
              crossRef: z.number().min(0).max(10).optional(),
              sourceAlign: z.number().min(0).max(10).optional(),
              attribution: z.number().min(0).max(10).optional(),
              score: z.number().min(0).max(10),
              date: z.string(),
              model: z.string().optional(),
            })
            .optional(),
          factCheck: z
            .object({
              accuracy: z.number().min(0).max(10).optional(),
              fidelity: z.number().min(0).max(10).optional(),
              consistency: z.number().min(0).max(10).optional(),
              score: z.number().min(0).max(10),
              date: z.string(),
              model: z.string().optional(),
            })
            .optional(),
          freshEyes: z
            .object({
              readability: z.number().min(0).max(10).optional(),
              firstImpression: z.number().min(0).max(10).optional(),
              score: z.number().min(0).max(10),
              date: z.string(),
              model: z.string().optional(),
            })
            .optional(),
          vibe: z
            .object({
              persona: z.number().min(0).max(10).optional(),
              clawdNote: z.number().min(0).max(10).optional(),
              vibe: z.number().min(0).max(10).optional(),
              clarity: z.number().min(0).max(10).optional(),
              narrative: z.number().min(0).max(10).optional(),
              score: z.number().min(0).max(10),
              date: z.string(),
              model: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .refine(
      (data) => {
        // SP/CP posts are translations — translatedBy is required
        // SD/Lv posts are originals — translatedBy is optional
        if (data.ticketId && /^(SP|CP)-/.test(data.ticketId)) {
          return !!data.translatedBy;
        }
        return true;
      },
      {
        message:
          'SP/CP posts require translatedBy (model + harness) — this is a translation, not an original',
        path: ['translatedBy'],
      },
    ),
});

const briefsCollection = defineCollection({
  type: 'content',
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
