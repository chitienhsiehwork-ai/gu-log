import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    ticketId: z.string().optional(), // e.g., "SP-15", "CP-1", "SD-1"
    date: z.string(), // YYYY-MM-DD format
    source: z.string(), // e.g., "@0xdevshah on X"
    sourceUrl: z.string().url(),
    author: z.string().optional(), // for original author
    summary: z.string(), // for index page preview
    lang: z.enum(['zh-tw', 'en']).default('zh-tw'),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = {
  posts: postsCollection,
};
