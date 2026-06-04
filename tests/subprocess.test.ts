import { describe, expect, test } from 'bun:test';
import { buildSubprocessEnv, readLimitedText, readPreviewedStdout, runSubprocess } from '../src/providers/subprocess.ts';

describe('subprocess security boundaries', () => {
  test('caps previewed stdout before buffering unbounded provider output', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('abcdef'));
        controller.close();
      },
    });

    await expect(readPreviewedStdout(stream, {
      maxBytes: 5,
      onToken() {},
      limitLabel: 'provider stdout',
    })).rejects.toThrow('provider stdout exceeded 5 bytes');
  });

  test('caps stderr before buffering unbounded provider output', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('abcdef'));
        controller.close();
      },
    });

    await expect(readLimitedText(stream, {
      maxBytes: 5,
      limitLabel: 'provider stderr',
    })).rejects.toThrow('provider stderr exceeded 5 bytes');
  });

  test('builds subprocess env from an allowlist plus explicit provider env', () => {
    const env = buildSubprocessEnv({
      CURSOR_API_KEY: 'cursor-secret',
      OPENAI_API_KEY: undefined,
    });

    expect(env.CURSOR_API_KEY).toBe('cursor-secret');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });

  test('refuses project-local provider binaries unless explicitly allowed', async () => {
    await expect(runSubprocess({
      providerId: 'local-provider',
      providerLabel: 'local',
      reviewerId: 'reviewer',
      binary: './tool',
      args: [],
      cwd: '/repo',
      stdin: '',
      timeoutMs: 1000,
      signal: new AbortController().signal,
      bus: captureBus(),
    })).rejects.toThrow('Refusing to execute project-local provider binary');
  });
});

function captureBus() {
  return {
    emit() {},
    on() {
      return () => {};
    },
    onAny() {
      return () => {};
    },
  };
}
