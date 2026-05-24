import type { ExecCtx } from '../core/provider.ts';

export async function readPreviewedStdout(
  stream: ReadableStream<Uint8Array>,
  ctx: ExecCtx,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    out += chunk;
    ctx.bus.emit({
      type: 'reviewer.event',
      reviewerId: ctx.reviewerId ?? 'unknown',
      event: { type: 'token', text: chunk },
    });
  }

  out += decoder.decode();
  return out;
}
