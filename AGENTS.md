# Repository Guidelines

## Project Structure & Module Organization

Quorum is a Bun + TypeScript CLI for multi-reviewer code review. Source lives in `src/`: CLI entry points and commands are in `src/cli/`, provider integrations in `src/providers/`, review orchestration in `src/pipelines/` and `src/runtime/`, consensus logic in `src/consensus/`, and report/terminal rendering in `src/ui/`. Tests live in `tests/` with shared helpers in `tests/helpers/`. Documentation is in `docs/`, including assets under `docs/assets/`. The example user configuration is `quorum.yaml.example`; local `quorum.yaml` may contain machine-specific reviewer settings.

## Build, Test, and Development Commands

- `bun install`: install dependencies using Bun.
- `bun run quorum -- <command>`: run the CLI from source, for example `bun run quorum -- reviewers`.
- `bun test`: run the full test suite.
- `bun test tests/config.test.ts`: run one test file.
- `bun test --coverage`: run tests with coverage output.
- `bun run typecheck` or `bun run lint`: run `tsc --noEmit` with strict project settings.

## Coding Style & Naming Conventions

Write TypeScript as ESM and include `.ts` in relative imports, matching existing files. Prefer small, typed functions and explicit domain types from `src/core/` or local schema modules. The compiler enforces strict options including `noUnusedLocals`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`; treat type errors as lint failures. Use two-space indentation, single quotes, semicolons, and kebab-case file names such as `openrouter-client.test.ts` or `base-subprocess.ts`.

## Testing Guidelines

Tests use `bun:test` with `describe`, `test`, and `expect`. Name test files `*.test.ts` and keep them near the behavior they validate by mirroring source concepts, not source paths exactly. Prefer dependency injection and fake runtimes/providers over shelling out to real tools. When adding provider, CLI, config, or consensus behavior, add focused regression coverage and run both `bun test` and `bun run typecheck`.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, sometimes with conventional prefixes: `feat:`, `refactor:`, or `docs:`. Keep the first line specific, for example `Type consensus strategy config` or `feat: add provider flag`. Pull requests should describe the behavioral change, list verification commands, link related issues when available, and include screenshots or sample CLI output for user-visible terminal/report changes.

## Security & Configuration Tips

Do not commit secrets or local reviewer credentials. Keep real provider tokens in the environment and use `quorum.yaml.example` for shareable defaults. Be careful with report paths and subprocess provider changes; preserve safeguards around repository roots, redaction, and `allow_project_binary`.
