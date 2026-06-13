import type { MetaReviewFn } from '../../consensus/registry.ts';
import { outputInstructionsForTask } from '../../reviewers/output.ts';
import { createSubprocessProvider } from '../base-subprocess.ts';
import { createSubprocessMetaReviewer } from '../subprocess.ts';
import { ClaudeCodeConfigSchema } from './schema.ts';

export const claudeCodeFactory = createSubprocessProvider({
  type: 'claude-code',
  label: 'claude',
  schema: ClaudeCodeConfigSchema,
  buildStdin: (_, task) => task.instruction,
  processOutput: (raw) => raw,
  buildArgs: (cfg, _ctx, task) => {
    const args = [
      '--print',
      '--model',
      cfg.model,
      ...(cfg.variant ? ['--effort', cfg.variant] : []),
      ...cfg.extra_args,
      '--append-system-prompt',
      `${task.systemPrompt}\n\n${outputInstructionsForTask(task)}`,
    ];
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    return createSubprocessMetaReviewer(
      config.binary,
      () => ['--print', '--model', config.model],
      config.cwd ?? ctx.workspaceRoot,
      config.timeout_ms,
    );
  },
});
