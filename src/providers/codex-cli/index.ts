import type { MetaReviewFn } from '../../consensus/registry.ts';
import { ProviderRuntimeError } from '../../core/errors.ts';
import { createSubprocessProvider } from '../base-subprocess.ts';
import { createSubprocessMetaReviewer } from '../subprocess.ts';
import { CodexCliConfigSchema } from './schema.ts';

export const codexCliFactory = createSubprocessProvider({
  type: 'codex-cli',
  label: 'codex',
  schema: CodexCliConfigSchema,
  processOutput: (raw) => raw.trim(),
  buildArgs: (cfg, ctx, _task, cwd) => {
    const model = ctx.modelOverride?.model ?? cfg.model;
    const args = [
      'exec',
      '--sandbox',
      cfg.sandbox,
      '--color',
      'never',
      '-C',
      cwd,
      ...cfg.extra_args,
    ];
    if (cfg.approval_policy === 'never') {
      throw new ProviderRuntimeError(
        'codex-cli',
        'Unsafe no-approval Codex mode is disabled',
      );
    }
    if (model) args.push('--model', model);
    if (cfg.variant) args.push('-c', `model_reasoning_effort=${cfg.variant}`);
    args.push('-');
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    return createSubprocessMetaReviewer(
      config.binary,
      () => ['exec', '--sandbox', config.sandbox, '--color', 'never', '-'],
      config.cwd ?? ctx.workspaceRoot,
      config.timeout_ms,
    );
  },
});
