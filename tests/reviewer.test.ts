import { describe, expect, test } from 'bun:test';
import type { EventBus } from '../src/core/events.ts';
import type { ExecCtx, Provider, ProviderCapabilities } from '../src/core/provider.ts';
import type { ReviewTask, ReviewResult } from '../src/core/task.ts';
import { bindReviewer } from '../src/reviewers/reviewer.ts';

const bus: EventBus = {
  emit() {},
  on() {
    return () => {};
  },
  onAny() {
    return () => {};
  },
};

function reviewOnlyCapabilities(): ProviderCapabilities {
  return {
    review: true,
    streaming: false,
    tools: false,
    mcp: false,
    localExecution: false,
    backgroundJobs: false,
    costReporting: false,
  };
}

describe('bindReviewer', () => {
  test('does not override provider model with an empty string when only sampling options are set', async () => {
    let capturedCtx: ExecCtx | undefined;

    const provider: Provider = {
      id: 'provider-a',
      kind: 'http',
      capabilities: reviewOnlyCapabilities,
      async review(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult> {
        capturedCtx = ctx;
        return {
          taskId: task.id,
          reviewerId: task.reviewerId,
          findings: [],
          rawOutput: '{"findings":[]}',
          durationMs: 1,
        };
      },
    };

    const reviewer = bindReviewer(
      {
        id: 'security-openrouter',
        personaId: 'security',
        providerId: 'provider-a',
        overrides: { temperature: 0.1 },
      },
      {
        id: 'security',
        description: 'Security review',
        system: 'Review security issues.',
      },
      provider,
    );

    await reviewer.run(
      { id: 'task-1', instruction: 'review this diff', workspace: { root: '/repo' } },
      { bus, signal: new AbortController().signal, workspace: { root: '/repo' } },
    );

    expect(capturedCtx?.modelOverride).toEqual({ temperature: 0.1 });
  });
});
