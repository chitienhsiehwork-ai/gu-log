import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: z
    .object({
      title: z.string(),
      ticketId: z.string().optional(), // e.g., "SP-15", "CP-1", "SD-1", "Lv-1"
      originalDate: z.string(), // Original publish date (YYYY-MM-DD format)
      translatedDate: z.string().optional(), // Translation date (YYYY-MM-DD format)
      translatedBy: z
        .object({
          model: z.string(),
          harness: z.string(),
        })
        .optional(),
      source: z.string(), // e.g., "@0xdevshah on X"
      sourceUrl: z.string().url(),
      author: z.string().optional(), // for original author
      summary: z.string(), // for index page preview
      lang: z.enum(['zh-tw', 'en']).default('zh-tw'),
      tags: z.array(z.string()).optional(),
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
