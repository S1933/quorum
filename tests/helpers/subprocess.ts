import type { EventBus } from '../../src/core/events.ts';
import type { ReviewTask } from '../../src/core/task.ts';

export function task(root: string, reviewerId: string): ReviewTask {
  return {
    kind: 'review',
    id: 'task-1',
    reviewerId,
    systemPrompt: 'Review security issues.',
    instruction: 'Review this diff.',
    workspace: { root },
  };
}

export function captureBus(events: unknown[] = []): EventBus {
  return {
    emit(e: unknown) {
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

export function tokenText(events: unknown[]): string {
  return events
    .map((event) => event as { event?: { type?: string; text?: string } })
    .filter((event) => event.event?.type === 'token')
    .map((event) => event.event?.text ?? '')
    .join('');
}
