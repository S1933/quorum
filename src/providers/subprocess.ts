import type { EventBus } from '../core/events.ts';
import type { ReviewTask, ReviewResult } from '../core/task.ts';
import { ProviderRuntimeError } from '../core/errors.ts';
import { parseFindings } from '../reviewers/output.ts';

export interface SubprocessRunOptions {
  providerId: string;
  providerLabel: string;
  reviewerId: string;
  binary: string;
  args: string[];
  cwd: string;
  stdin: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  signal: AbortSignal;
  bus: EventBus;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export const DEFAULT_SUBPROCESS_STDOUT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_SUBPROCESS_STDERR_MAX_BYTES = 64 * 1024;
const DEFAULT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TERM',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
] as const;

export async function runSubprocess(opts: SubprocessRunOptions): Promise<string> {
  const proc = Bun.spawn({
    cmd: [opts.binary, ...opts.args],
    cwd: opts.cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: buildSubprocessEnv(opts.env),
  });

  const writer = proc.stdin as unknown as { write: (s: string) => void; end: () => void };
  writer.write(opts.stdin);
  writer.end();

  const onAbort = () => proc.kill();
  if (opts.signal.aborted) {
    proc.kill();
    throw new DOMException('Aborted', 'AbortError');
  }
  opts.signal.addEventListener('abort', onAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs);

  try {
    const maxStdoutBytes = opts.maxStdoutBytes ?? DEFAULT_SUBPROCESS_STDOUT_MAX_BYTES;
    const maxStderrBytes = opts.maxStderrBytes ?? DEFAULT_SUBPROCESS_STDERR_MAX_BYTES;
    const [stdout, stderr, exitCode] = await Promise.all([
      readPreviewedStdout(proc.stdout, {
        providerId: opts.providerId,
        maxBytes: maxStdoutBytes,
        onLimit: () => proc.kill(),
        limitLabel: `${opts.providerLabel} stdout`,
        onToken: (text) => {
          opts.bus.emit({
            type: 'reviewer.event',
            reviewerId: opts.reviewerId,
            event: { type: 'token', text },
          });
        },
      }),
      readLimitedText(proc.stderr, {
        providerId: opts.providerId,
        maxBytes: maxStderrBytes,
        onLimit: () => proc.kill(),
        limitLabel: `${opts.providerLabel} stderr`,
      }),
      proc.exited,
    ]);

    if (timedOut) {
      throw new ProviderRuntimeError(
        opts.providerId,
        `${opts.providerLabel} timed out after ${opts.timeoutMs}ms`,
      );
    }

    if (exitCode !== 0) {
      throw new ProviderRuntimeError(
        opts.providerId,
        `${opts.providerLabel} exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
      );
    }
    return stdout;
  } catch (err) {
    proc.kill();
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
  }
}

export function buildSubprocessEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DEFAULT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function buildSubprocessReviewResult(
  task: ReviewTask,
  raw: string,
  started: number,
  bus: EventBus,
): ReviewResult {
  const findings = parseFindings(raw, task.reviewerId);
  for (const finding of findings) {
    bus.emit({
      type: 'reviewer.event',
      reviewerId: task.reviewerId,
      event: { type: 'finding', finding },
    });
  }
  return {
    taskId: task.id,
    reviewerId: task.reviewerId,
    findings,
    rawOutput: raw,
    durationMs: Date.now() - started,
  };
}

const DEFAULT_UNWRAP_KEYS = ['output', 'response', 'text', 'content', 'message'];

export function normaliseSubprocessOutput(raw: string, unwrapKeys: string[] = DEFAULT_UNWRAP_KEYS): string {
  const text = raw.trim();
  if (!text) return text;

  const direct = parseJsonObject(text);
  if (direct) return unwrapJsonOutput(direct, unwrapKeys) ?? text;

  const chunks = text
    .split('\n')
    .map((line) => parseJsonObject(line))
    .filter((value): value is Record<string, unknown> => value !== null)
    .map((value) => unwrapJsonOutput(value, unwrapKeys))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return chunks.length > 0 ? chunks.join('\n') : text;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function unwrapJsonOutput(value: Record<string, unknown>, keys: string[]): string | null {
  if (Array.isArray(value.findings)) return JSON.stringify(value);

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string') return candidate;
  }

  const message = value.message;
  if (typeof message === 'object' && message !== null) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }

  return null;
}

export async function readPreviewedStdout(
  stream: ReadableStream<Uint8Array>,
  opts: {
    onToken(text: string): void;
    providerId?: string;
    maxBytes?: number;
    onLimit?: () => void;
    limitLabel?: string;
  },
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const maxBytes = opts.maxBytes ?? DEFAULT_SUBPROCESS_STDOUT_MAX_BYTES;
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      opts.onLimit?.();
      throw new ProviderRuntimeError(
        opts.providerId ?? 'subprocess',
        `${opts.limitLabel ?? 'subprocess stdout'} exceeded ${maxBytes} bytes`,
      );
    }
    const chunk = decoder.decode(value, { stream: true });
    chunks.push(chunk);
    opts.onToken(chunk);
  }

  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return chunks.join('');
}

export async function readLimitedText(
  stream: ReadableStream<Uint8Array>,
  opts: { providerId?: string; maxBytes?: number; onLimit?: () => void; limitLabel?: string },
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const maxBytes = opts.maxBytes ?? DEFAULT_SUBPROCESS_STDERR_MAX_BYTES;
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      opts.onLimit?.();
      throw new ProviderRuntimeError(
        opts.providerId ?? 'subprocess',
        `${opts.limitLabel ?? 'subprocess stderr'} exceeded ${maxBytes} bytes`,
      );
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return chunks.join('');
}
