import { afterEach, describe, expect, test } from 'bun:test';
import { OpenRouterClient } from '../src/providers/openrouter/client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenRouterClient', () => {
  test('streams tokens and usage events from SSE chunks', async () => {
    let requestBody: unknown;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"{\\"findings\\":"}}]}\n\n'));
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"[]}"}}]}\n\n'));
            controller.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new OpenRouterClient(
      {
        type: 'openrouter',
        api_key: 'test-key',
        model: 'test-model',
        base_url: 'https://openrouter.test/api/v1',
      },
      'openrouter-test',
    );

    const events = [];
    for await (const event of client.chatStream(
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'review' }],
        stream_options: { include_usage: true },
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(requestBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(events).toEqual([
      { type: 'token', text: '{"findings":' },
      { type: 'token', text: '[]}' },
      { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    ]);
  });
});
