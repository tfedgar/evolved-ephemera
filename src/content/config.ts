import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string(),
    excerpt: z.string(),
    publishDate: z.coerce.date(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    heroImage: z.string().optional(),
    heroImageAlt: z.string().optional(),
    author: z.object({
      name: z.string(),
      bio: z.string().optional(),
      avatar: z.string().optional(),
    }),
    category: z.enum(['training', 'nutrition', 'recovery', 'mindset', 'client-success', 'general-health']),
    tags: z.array(z.string()),
    gallery: z.array(z.string()).optional(),
    videos: z.array(z.object({
      title: z.string(),
      url: z.string(),
      thumbnail: z.string().optional(),
    })).optional(),
    seo: z.object({
      canonicalUrl: z.string().optional(),
      ogImage: z.string().optional(),
      ogTitle: z.string().optional(),
      ogDescription: z.string().optional(),
      noindex: z.boolean().default(false),
    }).optional(),
    relatedPosts: z.array(z.string()).optional(),
  }),
});

export const collections = {
  blog,
};
