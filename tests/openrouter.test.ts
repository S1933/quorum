import { afterEach, describe, expect, test } from 'bun:test';
import type { EventBus } from '../src/core/events.ts';
import type { ReviewTask } from '../src/core/task.ts';
import { openRouterFactory } from '../src/providers/openrouter/index.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('openrouter provider', () => {
  test('streams chat completion tokens during review', async () => {
    let requestBody: unknown;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"{\\"findings\\":"}}]}\n\n'));
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"[]}"}}]}\n\n'));
            controller.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = await openRouterFactory.create(
      'openrouter-test',
      {
        type: 'openrouter',
        api_key: 'test-key',
        model: 'anthropic/test',
        base_url: 'https://openrouter.test/api/v1',
      },
      { workspaceRoot: '/tmp/quorum', env: {} },
    );
    const events: unknown[] = [];

    const result = await provider.review!(task(), {
      bus: captureBus(events),
      signal: new AbortController().signal,
      workspace: { root: '/tmp/quorum' },
    });

    expect(requestBody).toMatchObject({
      model: 'anthropic/test',
      stream: true,
      response_format: { type: 'json_object' },
      stream_options: { include_usage: true },
    });
    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toBe('{"findings":[]}');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(tokenText(events)).toBe('{"findings":[]}');
  });
});

function task(): ReviewTask {
  return {
    kind: 'review',
    id: 'task-1',
    reviewerId: 'security-openrouter',
    systemPrompt: 'Review security issues.',
    instruction: 'Review this diff.',
    workspace: { root: '/tmp/quorum' },
  };
}

function captureBus(events: unknown[]): EventBus {
  return {
    emit(e) {
      events.push(e);
    },
    on() {
      return () => {};
    },
    onAny() {
      return () => {};
    },
  };
}

function tokenText(events: unknown[]): string {
  return events
    .map((event) => event as { event?: { type?: string; text?: string } })
    .filter((event) => event.event?.type === 'token')
    .map((event) => event.event?.text ?? '')
    .join('');
}
