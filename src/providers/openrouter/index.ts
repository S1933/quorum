import type { Provider, ProviderCapabilities, ExecCtx } from '../../core/provider.ts';
import type { ReviewTask, ReviewResult } from '../../core/task.ts';
import type { ProviderFactory } from '../registry.ts';
import { ProviderRuntimeError } from '../../core/errors.ts';
import { OpenRouterConfigSchema, type OpenRouterConfig } from './schema.ts';
import { OpenRouterClient, type ChatMessage } from './client.ts';
import { parseFindings, REVIEW_OUTPUT_INSTRUCTIONS } from '../../reviewers/output.ts';

const PROVIDER_TYPE = 'openrouter';

class OpenRouterProvider implements Provider {
  readonly kind = 'http' as const;
  private readonly client: OpenRouterClient;

  constructor(readonly id: string, private readonly cfg: OpenRouterConfig) {
    this.client = new OpenRouterClient(cfg, id);
  }

  capabilities(): ProviderCapabilities {
    return {
      review: true,
      streaming: true,
      tools: false,
      mcp: false,
      localExecution: false,
      backgroundJobs: false,
      costReporting: true,
    };
  }

  async review(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult> {
    const started = Date.now();
    const messages: ChatMessage[] = [
      { role: 'system', content: `${task.systemPrompt}\n\n${REVIEW_OUTPUT_INSTRUCTIONS}` },
      { role: 'user', content: task.instruction },
    ];

    const res = await this.client.chat(
      reviewRequest(this.cfg, ctx, messages),
      ctx.signal,
    );

    const raw = res.choices[0]?.message.content ?? '';
    const findings = parseFindings(raw, task.reviewerId);

    for (const finding of findings) {
      ctx.bus.emit({
        type: 'reviewer.event',
        reviewerId: task.reviewerId,
        event: { type: 'finding', finding },
      });
    }

    const usage = res.usage
      ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
      : undefined;

    if (usage) {
      ctx.bus.emit({
        type: 'reviewer.event',
        reviewerId: task.reviewerId,
        event: { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      });
    }

    const base = {
      taskId: task.id,
      reviewerId: task.reviewerId,
      findings,
      rawOutput: raw,
      durationMs: Date.now() - started,
    };
    return usage ? { ...base, usage } : base;
  }

  async *stream(task: ReviewTask, ctx: ExecCtx) {
    const messages: ChatMessage[] = [
      { role: 'system', content: `${task.systemPrompt}\n\n${REVIEW_OUTPUT_INSTRUCTIONS}` },
      { role: 'user', content: task.instruction },
    ];

    try {
      for await (const chunk of this.client.chatStream(
        chatRequest(this.cfg, ctx, messages),
        ctx.signal,
      )) {
        yield { type: 'token' as const, text: chunk };
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      throw new ProviderRuntimeError(this.id, `stream failed: ${(err as Error).message}`, err);
    }
  }
}

function chatRequest(
  cfg: OpenRouterConfig,
  ctx: ExecCtx,
  messages: ChatMessage[],
): Parameters<OpenRouterClient['chat']>[0] {
  const req: Parameters<OpenRouterClient['chat']>[0] = {
    model: ctx.modelOverride?.model ?? cfg.model,
    messages,
  };
  const temperature = ctx.modelOverride?.temperature ?? cfg.temperature;
  const maxTokens = ctx.modelOverride?.maxTokens ?? cfg.max_tokens;
  const topP = ctx.modelOverride?.topP ?? cfg.top_p;
  if (temperature !== undefined) req.temperature = temperature;
  if (maxTokens !== undefined) req.max_tokens = maxTokens;
  if (topP !== undefined) req.top_p = topP;
  return req;
}

function reviewRequest(
  cfg: OpenRouterConfig,
  ctx: ExecCtx,
  messages: ChatMessage[],
): Parameters<OpenRouterClient['chat']>[0] {
  return {
    ...chatRequest(cfg, ctx, messages),
    response_format: { type: 'json_object' },
  };
}

export const openRouterFactory: ProviderFactory = {
  type: PROVIDER_TYPE,
  schema: OpenRouterConfigSchema,
  async create(instanceId, config, _ctx) {
    return new OpenRouterProvider(instanceId, config as OpenRouterConfig);
  },
};
