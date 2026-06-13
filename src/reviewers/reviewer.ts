import { CapabilityError, ReviewerOutputError } from '../core/errors.ts';
import type { Persona } from '../core/persona.ts';
import type { ReviewerRef } from '../core/pipeline.ts';
import type { ExecCtx, Provider } from '../core/provider.ts';
import type { ModelConfig, ReviewResult, ReviewTask } from '../core/task.ts';
import { RETRY_REMINDER } from './output.ts';

type BoundReviewerTask = Omit<
  ReviewTask,
  'systemPrompt' | 'reviewerId' | 'kind'
> & {
  kind?: ReviewTask['kind'];
};

export interface BoundReviewer {
  id: string;
  persona: Persona;
  provider: Provider;
  overrides?: ModelConfig;
  run(
    task: BoundReviewerTask,
    ctx: Omit<ExecCtx, 'modelOverride'>,
  ): Promise<ReviewResult>;
}

export function bindReviewer(
  ref: ReviewerRef,
  persona: Persona,
  provider: Provider,
): BoundReviewer {
  if (!provider.review) {
    throw new CapabilityError(
      `Reviewer "${ref.id}" bound to provider "${provider.id}" which does not implement review()`,
    );
  }
  if (!provider.capabilities().review) {
    throw new CapabilityError(
      `Reviewer "${ref.id}": provider "${provider.id}" reports review capability disabled`,
    );
  }

  return {
    id: ref.id,
    persona,
    provider,
    ...(ref.overrides ? { overrides: ref.overrides } : {}),
    async run(task, ctx) {
      const fullTask: ReviewTask = {
        ...task,
        kind: task.kind ?? 'review',
        systemPrompt: persona.system,
        reviewerId: ref.id,
      };
      const modelOverride = ref.overrides;
      const execCtx: ExecCtx = modelOverride
        ? { ...ctx, modelOverride, reviewerId: ref.id }
        : { ...ctx, reviewerId: ref.id };
      try {
        return await provider.review!(fullTask, execCtx);
      } catch (err) {
        // The model occasionally answers in prose instead of the JSON envelope
        // (seen with high-thinking models that narrate a clean pass). Retry once
        // with a corrective reminder appended — every provider places the
        // instruction last, so the reminder is the final thing the model sees.
        if (!(err instanceof ReviewerOutputError) || execCtx.signal.aborted)
          throw err;
        const retryTask: ReviewTask = {
          ...fullTask,
          instruction: `${fullTask.instruction}\n\n${RETRY_REMINDER}`,
        };
        return await provider.review!(retryTask, execCtx);
      }
    },
  };
}
