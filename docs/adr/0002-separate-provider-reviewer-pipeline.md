# ADR 0002: Separate providers, reviewers, and pipelines

## Status

Accepted, 2026-06-08

## Context

Quorum needs to run multiple AI reviewers over the same diff and compare their findings. A provider is an execution mechanism, a reviewer is a persona bound to a provider configuration, and a pipeline is an ordered or parallel set of reviewers with optional consensus behavior.

The code models this split in `src/core/provider.ts`, `src/core/pipeline.ts`, and `src/reviewers/reviewer.ts`.

## Decision

Keep providers, reviewers, and pipelines as separate concepts.

- Providers own transport and model execution.
- Reviewers bind a persona to provider configuration and optional model overrides.
- Pipelines reference reviewer ids and define execution options such as parallelism, limits, timeout, and consensus strategy.

## Consequences

- The same persona can run through different providers or models.
- Pipelines can compose existing reviewers without duplicating provider details.
- Consensus operates on review results rather than provider-specific outputs.
- Configuration has more indirection than a single inline review command, but the domain model stays explicit.
