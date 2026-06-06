import { z } from 'zod';

export const ClaudeCodeConfigSchema = z
  .object({
    type: z.literal('claude-code'),
    model: z.string().min(1),
    variant: z.string().min(1).optional(),
    binary: z.string().default('claude'),
    allow_project_binary: z.boolean().default(false),
    extra_args: z.array(z.never()).default([]),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().default(120_000),
  })
  .strict();

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
