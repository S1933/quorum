# ADR 0003: Use Zod-validated YAML configuration

## Status

Accepted, 2026-06-08

## Context

Quorum configuration is user-authored and controls personas, reviewers, providers, defaults, diff limits, and pipelines. Provider-specific blocks need room for adapter-specific fields, while the top-level Quorum structure must remain strict enough to catch mistakes.

The schema lives in `src/config/schema.ts`; provider-specific schemas are validated by provider factories during instantiation.

## Decision

Use YAML for user configuration and validate it with Zod.

Top-level config, personas, reviewers, pipelines, model overrides, and consensus config are strict schemas. Provider config requires a `type` field and allows provider-specific fields, then each provider factory validates its own config schema.

Environment interpolation through `env:VAR` and `${VAR}` is resolved before provider schema validation.

## Consequences

- Users get structured validation errors for common config mistakes.
- Provider adapters can evolve their own config without changing the global schema for every field.
- Secret values can stay outside the repository through environment interpolation.
- Some provider errors are discovered at provider instantiation time rather than at initial YAML parse time.
