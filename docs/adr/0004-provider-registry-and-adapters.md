# ADR 0004: Use a provider registry with adapter factories

## Status

Accepted, 2026-06-08

## Context

Quorum supports API providers and local agent CLIs behind one review-focused provider interface. Built-in providers include OpenRouter, Ollama, Claude Code, Codex CLI, Gemini CLI, Kilo Code, OpenCode, and Cursor Agent CLI.

The provider registry in `src/providers/registry.ts` maps provider `type` values to factories. Subprocess providers share behavior through `src/providers/base-subprocess.ts` and `src/providers/subprocess.ts`.

## Decision

Register providers through `ProviderFactory` objects that own schema validation and provider creation.

Each factory exposes a stable provider `type`, a Zod schema, and a `create` function. Optional meta-reviewer support is exposed through `createMetaReviewer` for consensus strategies that need it.

Use shared subprocess adapter infrastructure for local CLI providers, including trusted-binary checks, environment allowlisting, stdout/stderr limits, timeout handling, and output normalization.

## Consequences

- Adding a built-in provider is mostly localized to a provider module and registry registration.
- HTTP and subprocess providers satisfy the same review interface.
- Local CLI execution has explicit safety controls around project-local binaries and inherited environment variables.
- External plugin discovery is not implied by the registry alone; it would need a separate loading mechanism.
