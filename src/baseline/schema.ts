import { z } from 'zod';

export const FindingSchema = z.object({
  line: z
    .number()
    .int()
    .positive()
    .describe('1-indexed line number in the new file the comment anchors to.'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low', 'nit'])
    .describe('Rough impact at production scale.'),
  title: z.string().min(1).describe('Short headline, < 80 chars.'),
  comment: z
    .string()
    .min(1)
    .describe(
      'The review comment. Explain the scaling concern, why it matters, and a concrete fix.',
    ),
});

export const ReviewSchema = z.object({
  findings: z
    .array(FindingSchema)
    .describe('Empty array when the diff has no query-performance concerns.'),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Review = z.infer<typeof ReviewSchema>;
