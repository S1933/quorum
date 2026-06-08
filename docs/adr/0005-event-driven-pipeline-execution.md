# ADR 0005: Execute review pipelines through an event-driven runtime

## Status

Accepted, 2026-06-08

## Context

Review execution can involve multiple reviewers, subprocess output, long-running provider calls, timeouts, partial failures, token previews, findings, cost usage, and final reports. Terminal rendering should observe progress without being coupled to provider implementation details.

The pipeline executor lives in `src/pipelines/executor.ts`; provider execution receives an `EventBus` through `ExecCtx`.

## Decision

Run pipelines through an event-driven executor.

The executor emits lifecycle events for pipeline and reviewer start, finish, failure, timeout, and budget state. Providers emit reviewer events such as token previews, findings, logs, and usage. UI renderers subscribe to the event bus, while reports are generated from the final `PipelineResult`.

Pipelines support parallel and sequential execution, optional concurrency limits, reviewer limits, timeout cancellation, and total-cost budget tracking.

## Consequences

- Terminal progress and provider execution stay decoupled.
- Partial reviewer failures can be reported without discarding successful reviews.
- Parallel execution improves latency while `maxConcurrency` allows local resource control.
- Cancellation and budget behavior must be handled consistently across providers.
