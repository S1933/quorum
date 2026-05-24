import { z } from 'zod';

const SafeExtraArgSchema = z.enum([
  '--ephemeral',
  '--ignore-rules',
  '--ignore-user-config',
  '--skip-git-repo-check',
  '--strict-config',
]);

export const CodexCliConfigSchema = z
  .object({
    type: z.literal('codex-cli'),
    model: z.string().min(1).optional(),
    binary: z.string().min(1).default('codex'),
    sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('read-only'),
    approval_policy: z.enum(['untrusted', 'on-request', 'never']).default('never'),
    extra_args: z.array(SafeExtraArgSchema).default([]),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().default(120_000),
  })
  .strict()
  .refine(
    (cfg) => cfg.sandbox !== 'danger-full-access' || cfg.approval_policy !== 'never',
    {
      message: 'danger-full-access requires approval_policy other than never',
      path: ['approval_policy'],
    },
  );

export type CodexCliConfig = z.infer<typeof CodexCliConfigSchema>;
