# ADR 0006: Use pluggable consensus strategies

## Status

Accepted, 2026-06-08

## Context

Quorum's core feature is comparing findings from multiple reviewers. Different review modes need different aggregation behavior: simple overlap, majority agreement, severity-aware thresholds, and semantic grouping with optional contradiction handling.

Consensus strategy types are defined in `src/core/pipeline.ts`; the registry and strategy interface live in `src/consensus/registry.ts`.

## Decision

Use a consensus registry keyed by strategy id.

Pipelines select a consensus strategy through config. Each strategy receives review results and consensus config, then returns grouped findings, agreement counts, unique findings, contradictions, and its strategy id.

Support the implemented strategies `overlap-v1`, `majority-v1`, `severity-aware-v1`, and `semantic-v2`. Allow `semantic-v2` to use an optional meta-reviewer provider for contradiction resolution when configured.

## Consequences

- Consensus behavior can evolve without changing the pipeline executor contract.
- Reports can consume one stable `ConsensusResult` shape across strategies.
- Strategy-specific config stays explicit through discriminated TypeScript and Zod unions.
- More strategies increase testing responsibility for grouping, threshold, and contradiction behavior.
