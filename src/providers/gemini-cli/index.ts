import type { MetaReviewFn } from '../../consensus/registry.ts';
import { createSubprocessProvider, STDIN_PROMPT } from '../base-subprocess.ts';
import { createSubprocessMetaReviewer } from '../subprocess.ts';
import { GeminiCliConfigSchema } from './schema.ts';

export const geminiCliFactory = createSubprocessProvider({
  type: 'gemini-cli',
  label: 'gemini',
  schema: GeminiCliConfigSchema,
  processOutput: (raw) => raw.trim(),
  buildArgs: (cfg, ctx) => {
    const model = ctx.modelOverride?.model ?? cfg.model;
    const args = [
      '--prompt',
      STDIN_PROMPT,
      '--approval-mode',
      cfg.approval_mode,
      '--output-format',
      'text',
      ...cfg.extra_args,
    ];
    if (cfg.sandbox) args.push('--sandbox');
    if (cfg.skip_trust) args.push('--skip-trust');
    if (model) args.push('--model', model);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    return createSubprocessMetaReviewer(
      config.binary,
      () => {
        const args = [
          '--approval-mode',
          config.approval_mode,
          '--output-format',
          'text',
        ];
        if (config.sandbox) args.push('--sandbox');
        if (config.skip_trust) args.push('--skip-trust');
        return args;
      },
      config.cwd ?? ctx.workspaceRoot,
      config.timeout_ms,
    );
  },
});
