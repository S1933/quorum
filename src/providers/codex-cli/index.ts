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
    const c = CodexCliConfigSchema.parse(cfg);
    const model = ctx.modelOverride?.model ?? c.model;
    const args = [
      'exec',
      '--sandbox',
      c.sandbox,
      '--color',
      'never',
      '-C',
      cwd,
      ...c.extra_args,
    ];
    if (c.approval_policy === 'never') {
      throw new ProviderRuntimeError(
        'codex-cli',
        'Unsafe no-approval Codex mode is disabled',
      );
    }
    if (model) args.push('--model', model);
    if (c.variant) args.push('-c', `model_reasoning_effort=${c.variant}`);
    args.push('-');
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = CodexCliConfigSchema.parse(config);
    return createSubprocessMetaReviewer(
      c.binary,
      () => ['exec', '--sandbox', c.sandbox, '--color', 'never', '-'],
      c.cwd ?? ctx.workspaceRoot,
      c.timeout_ms,
    );
  },
});
