import type { Provider, ProviderCapabilities, ExecCtx } from '../../core/provider.ts';
import type { ReviewTask, ReviewResult, UsageInfo } from '../../core/task.ts';
import type { ProviderFactory } from '../registry.ts';
import type { MetaReviewFn } from '../../consensus/registry.ts';
import { ProviderRuntimeError } from '../../core/errors.ts';
import { OpenRouterConfigSchema, type OpenRouterConfig } from './schema.ts';
import { OpenRouterClient, type ChatMessage } from './client.ts';
import { outputInstructionsForTask, parseReviewOutput } from '../../reviewers/output.ts';

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
    };
  }

  async review(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult> {
    const started = Date.now();
    const messages: ChatMessage[] = [
      { role: 'system', content: `${task.systemPrompt}\n\n${outputInstructionsForTask(task)}` },
      { role: 'user', content: task.instruction },
    ];

    const chunks: string[] = [];
    let usage: UsageInfo | undefined;
    for await (const event of this.client.chatStream(
      reviewRequest(this.cfg, ctx, messages),
      ctx.signal,
    )) {
      if (event.type === 'token') {
        chunks.push(event.text);
        ctx.bus.emit({
          type: 'reviewer.event',
          reviewerId: task.reviewerId,
          event: { type: 'token', text: event.text },
        });
      } else if (event.type === 'chunk_parse_error') {
        ctx.bus.emit({
          type: 'reviewer.event',
          reviewerId: task.reviewerId,
          event: { type: 'log', level: 'warn', msg: `skipped malformed chunk: ${event.raw}` },
        });
      } else if (event.usage) {
        const costUsd = event.usage.cost;
        usage = {
          inputTokens: event.usage.prompt_tokens,
          outputTokens: event.usage.completion_tokens,
        };
        if (costUsd !== undefined) usage.costUsd = costUsd;
        const usageEvent: { type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number } = {
          type: 'usage',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        };
        if (costUsd !== undefined) usageEvent.costUsd = costUsd;
        ctx.bus.emit({
          type: 'reviewer.event',
          reviewerId: task.reviewerId,
          event: usageEvent,
        });
      }
    }

    const raw = chunks.join('');
    const parsed = parseReviewOutput(raw, task.reviewerId);
    const { findings } = parsed;

    for (const finding of findings) {
      ctx.bus.emit({
        type: 'reviewer.event',
        reviewerId: task.reviewerId,
        event: { type: 'finding', finding },
      });
    }

    const result = {
      taskId: task.id,
      reviewerId: task.reviewerId,
      findings,
      ...(parsed.verdict ? { verdict: parsed.verdict } : {}),
      rawOutput: raw,
      durationMs: Date.now() - started,
    };
    return usage ? { ...result, usage } : result;
  }

  async *stream(task: ReviewTask, ctx: ExecCtx) {
    const messages: ChatMessage[] = [
      { role: 'system', content: `${task.systemPrompt}\n\n${outputInstructionsForTask(task)}` },
      { role: 'user', content: task.instruction },
    ];

    try {
      for await (const event of this.client.chatStream(
        chatRequest(this.cfg, ctx, messages),
        ctx.signal,
      )) {
        if (event.type === 'token') yield { type: 'token' as const, text: event.text };
        else if (event.type === 'chunk_parse_error') yield { type: 'log' as const, level: 'warn' as const, msg: `skipped malformed chunk: ${event.raw}` };
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
  if (cfg.variant) req.reasoning = { effort: cfg.variant };
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
    stream_options: { include_usage: true },
  };
}

export const openRouterFactory: ProviderFactory = {
  type: PROVIDER_TYPE,
  schema: OpenRouterConfigSchema,
  async create(instanceId, config, _ctx) {
    return new OpenRouterProvider(instanceId, config as OpenRouterConfig);
  },
  createMetaReviewer(config, _ctx): MetaReviewFn | undefined {
    const cfg = config as OpenRouterConfig;
    const client = new OpenRouterClient(cfg, 'meta-review');
    return async (prompt, ctx): Promise<string> => {
      const chunks: string[] = [];
      const req: Parameters<OpenRouterClient['chat']>[0] = {
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
      };
      if (cfg.max_tokens !== undefined) req.max_tokens = cfg.max_tokens;
      if (cfg.variant) req.reasoning = { effort: cfg.variant };
      for await (const event of client.chatStream(req, ctx.signal)) {
        if (event.type === 'token') chunks.push(event.text);
      }
      return chunks.join('').trim() || '{}';
    };
  },
};
