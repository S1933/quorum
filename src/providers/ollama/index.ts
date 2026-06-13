import { ProviderRuntimeError } from '../../core/errors.ts';
import type {
  ExecCtx,
  Provider,
  ProviderCapabilities,
} from '../../core/provider.ts';
import type { ReviewResult, ReviewTask, UsageInfo } from '../../core/task.ts';
import {
  outputInstructionsForTask,
  parseReviewOutput,
} from '../../reviewers/output.ts';
import type { ProviderFactory } from '../registry.ts';
import {
  type OllamaChatRequest,
  OllamaClient,
  type OllamaMessage,
} from './client.ts';
import { type OllamaConfig, OllamaConfigSchema } from './schema.ts';

const PROVIDER_TYPE = 'ollama';

class OllamaProvider implements Provider {
  private readonly client: OllamaClient;

  constructor(
    readonly id: string,
    private readonly cfg: OllamaConfig,
  ) {
    this.client = new OllamaClient(cfg, id);
  }

  capabilities(): ProviderCapabilities {
    return {
      review: true,
      streaming: true,
      tools: false,
      mcp: false,
      localExecution: true,
    };
  }

  async review(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult> {
    const started = Date.now();
    const chunks: string[] = [];
    let usage: UsageInfo | undefined;
    for await (const event of this.client.chatStream(
      reviewRequest(this.cfg, ctx, messagesFor(task)),
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
          event: {
            type: 'log',
            level: 'warn',
            msg: `skipped malformed chunk: ${event.raw}`,
          },
        });
      } else {
        usage = {
          inputTokens: event.prompt_eval_count,
          outputTokens: event.eval_count,
        };
        ctx.bus.emit({
          type: 'reviewer.event',
          reviewerId: task.reviewerId,
          event: {
            type: 'usage',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
        });
      }
    }

    const raw = chunks.join('').trim();
    if (!raw) {
      throw new ProviderRuntimeError(
        this.id,
        'Ollama returned no message content',
      );
    }

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
}

function messagesFor(task: ReviewTask): OllamaMessage[] {
  return [
    {
      role: 'system',
      content: `${task.systemPrompt}\n\n${outputInstructionsForTask(task)}`,
    },
    { role: 'user', content: task.instruction },
  ];
}

function chatRequest(
  cfg: OllamaConfig,
  ctx: ExecCtx,
  messages: OllamaMessage[],
): OllamaChatRequest {
  const req: OllamaChatRequest = {
    model: ctx.modelOverride?.model ?? cfg.model,
    messages,
  };
  const options = toOptions(cfg, ctx);
  if (Object.keys(options).length > 0) req.options = options;
  if (cfg.keep_alive !== undefined) req.keep_alive = cfg.keep_alive;
  return req;
}

function reviewRequest(
  cfg: OllamaConfig,
  ctx: ExecCtx,
  messages: OllamaMessage[],
): OllamaChatRequest {
  return {
    ...chatRequest(cfg, ctx, messages),
    format: 'json',
  };
}

function toOptions(
  cfg: OllamaConfig,
  ctx: ExecCtx,
): NonNullable<OllamaChatRequest['options']> {
  const options: NonNullable<OllamaChatRequest['options']> = {};
  const temperature = ctx.modelOverride?.temperature ?? cfg.temperature;
  const maxTokens = ctx.modelOverride?.maxTokens ?? cfg.max_tokens;
  const topP = ctx.modelOverride?.topP ?? cfg.top_p;
  if (temperature !== undefined) options.temperature = temperature;
  if (maxTokens !== undefined) options.num_predict = maxTokens;
  if (topP !== undefined) options.top_p = topP;
  return options;
}

export const ollamaFactory: ProviderFactory = {
  type: PROVIDER_TYPE,
  schema: OllamaConfigSchema,
  async create(instanceId, config, _ctx) {
    return new OllamaProvider(instanceId, OllamaConfigSchema.parse(config));
  },
};
