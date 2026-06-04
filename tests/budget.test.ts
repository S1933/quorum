import { describe, expect, test } from 'bun:test';
import { BudgetTracker } from '../src/pipelines/budget.ts';

describe('BudgetTracker', () => {
  test('starts with zero state', () => {
    const tracker = new BudgetTracker({});
    const state = tracker.state();
    expect(state.totalInputTokens).toBe(0);
    expect(state.totalOutputTokens).toBe(0);
    expect(state.totalCostUsd).toBe(0);
    expect(state.exceeded).toBe(false);
    expect(state.reason).toBeUndefined();
  });

  test('records usage and accumulates correctly', () => {
    const tracker = new BudgetTracker({});
    tracker.record({ inputTokens: 100, outputTokens: 50 });
    tracker.record({ inputTokens: 200, outputTokens: 75, costUsd: 0.005 });

    const state = tracker.state();
    expect(state.totalInputTokens).toBe(300);
    expect(state.totalOutputTokens).toBe(125);
    expect(state.totalCostUsd).toBe(0.005);
    expect(state.exceeded).toBe(false);
  });

  test('handles undefined usage gracefully', () => {
    const tracker = new BudgetTracker({});
    const state = tracker.record(undefined);
    expect(state.totalInputTokens).toBe(0);
    expect(state.exceeded).toBe(false);
  });

  test('detects cost exceeding limit', () => {
    const tracker = new BudgetTracker({ maxTotalCostUsd: 0.01 });
    tracker.record({ inputTokens: 100, outputTokens: 50, costUsd: 0.006 });
    expect(tracker.isExceeded).toBe(false);

    const state = tracker.record({ inputTokens: 100, outputTokens: 50, costUsd: 0.006 });
    expect(state.exceeded).toBe(true);
    expect(tracker.isExceeded).toBe(true);
    expect(state.reason).toInclude('Cost limit exceeded');
    expect(state.totalCostUsd).toBe(0.012);
  });

  test('does not detect exceeded when cost within limit', () => {
    const tracker = new BudgetTracker({ maxTotalCostUsd: 0.10 });
    tracker.record({ inputTokens: 1000, outputTokens: 500, costUsd: 0.05 });
    expect(tracker.isExceeded).toBe(false);
  });

  test('does not detect exceeded when usage has no cost', () => {
    const tracker = new BudgetTracker({ maxTotalCostUsd: 0.01 });
    tracker.record({ inputTokens: 10000, outputTokens: 5000 });
    expect(tracker.isExceeded).toBe(false);
    expect(tracker.state().totalCostUsd).toBe(0);
  });

  test('only flags exceeded once', () => {
    const tracker = new BudgetTracker({ maxTotalCostUsd: 0.005 });
    tracker.record({ inputTokens: 100, outputTokens: 50, costUsd: 0.004 });
    expect(tracker.isExceeded).toBe(false);

    tracker.record({ inputTokens: 100, outputTokens: 50, costUsd: 0.002 });
    expect(tracker.isExceeded).toBe(true);

    tracker.record({ inputTokens: 100, outputTokens: 50, costUsd: 0.10 });
    expect(tracker.isExceeded).toBe(true);
    expect(tracker.state().totalCostUsd).toBeCloseTo(0.106, 6);
  });

  test('no limit means never exceeded', () => {
    const tracker = new BudgetTracker({});
    tracker.record({ inputTokens: 1000, outputTokens: 500, costUsd: 999 });
    expect(tracker.isExceeded).toBe(false);
  });
});
