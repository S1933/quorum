# ADR 0001: Use Bun and TypeScript for the CLI runtime

## Status

Accepted, 2026-06-08

## Context

Quorum is distributed as a command-line tool that runs review pipelines, reads local git state, executes provider adapters, and writes terminal or report output. The project uses TypeScript ESM throughout `src/`, with strict compiler checks configured in `tsconfig.json`.

The package manifest exposes `src/cli/index.ts` as the `quorum` binary and uses Bun scripts for local execution, testing, postinstall behavior, and type checking.

## Decision

Use Bun as the runtime and package runner, and TypeScript as the implementation language for the CLI and runtime.

The source remains ESM TypeScript with explicit `.ts` relative imports. Bun APIs are acceptable in runtime-facing code where they simplify subprocess execution, test execution, or CLI behavior.

## Consequences

- CLI execution, tests, and package scripts share one runtime.
- TypeScript strictness catches schema, optional-field, and exhaustiveness mistakes before runtime.
- Provider and workspace code can use Bun subprocess primitives directly.
- Consumers need Bun `>= 1.1`; Node-only execution is not a supported target.
