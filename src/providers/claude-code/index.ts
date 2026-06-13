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
    const c = ClaudeCodeConfigSchema.parse(cfg);
    const args = [
      '--print',
      '--model',
      c.model,
      ...(c.variant ? ['--effort', c.variant] : []),
      ...c.extra_args,
      '--append-system-prompt',
      `${task.systemPrompt}\n\n${outputInstructionsForTask(task)}`,
    ];
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = ClaudeCodeConfigSchema.parse(config);
    return createSubprocessMetaReviewer(
      c.binary,
      () => ['--print', '--model', c.model],
      c.cwd ?? ctx.workspaceRoot,
      c.timeout_ms,
    );
  },
});
