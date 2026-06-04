import { z } from 'zod';

export const OpenCodeConfigSchema = z
  .object({
    type: z.union([z.literal('opencode'), z.literal('opencode-go')]),
    model: z.string().min(1).optional(),
    binary: z.string().min(1).default('opencode'),
    allow_project_binary: z.boolean().default(false),
    command_style: z.enum(['prompt', 'run']).default('run'),
    output_format: z.enum(['text', 'json']).default('text'),
    quiet: z.boolean().default(true),
    extra_args: z.array(z.never()).default([]),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().default(120_000),
  })
  .strict();

export type OpenCodeConfig = z.infer<typeof OpenCodeConfigSchema>;
