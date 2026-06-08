import type { MetaReviewFn } from '../../consensus/registry.ts';
import { outputInstructionsForTask } from '../../reviewers/output.ts';
import { createSubprocessMetaReviewer } from '../subprocess.ts';
import { createSubprocessProvider } from '../base-subprocess.ts';
import { ClaudeCodeConfigSchema, type ClaudeCodeConfig } from './schema.ts';

export const claudeCodeFactory = createSubprocessProvider({
  type: 'claude-code',
  label: 'claude',
  schema: ClaudeCodeConfigSchema,
  buildStdin: (_, task) => task.instruction,
  processOutput: (raw) => raw,
  buildArgs: (cfg, _ctx, task) => {
    const c = cfg as ClaudeCodeConfig;
    const args = [
      '--print', '--model', c.model,
      ...(c.variant ? ['--effort', c.variant] : []),
      ...c.extra_args,
      '--append-system-prompt', `${task.systemPrompt}\n\n${outputInstructionsForTask(task)}`,
    ];
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = config as ClaudeCodeConfig;
    return createSubprocessMetaReviewer(
      c.binary, () => ['--print', '--model', c.model],
      c.cwd ?? ctx.workspaceRoot, c.timeout_ms,
    );
  },
});
