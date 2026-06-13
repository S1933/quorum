# Repository Guidelines — Quorum

Provider-agnostic multi-model consensus review for AI-assisted code changes. Runs multiple AI reviewers on a git diff and highlights findings they agree on.

See [`README.md`](README.md) for user-facing docs and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full domain model and design decisions. Architecture decisions are at [`docs/adr/`](docs/adr/).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | **Bun** ≥1.1 |
| Language | **TypeScript** 5.x (strict) |
| Config | **YAML** + **Zod** validation |
| CLI parsing | Hand-rolled in `src/cli/args.ts` |
| TUI dashboard | **Ink** + **React** |
| Reports | Markdown / JSON |
| Lint + format | **Biome** |
| Tests | **bun:test** |
| CI/CD | GitHub Actions (3 workflows) |
| Distribution | npm package, GitHub Action, Claude Code skill |

No frameworks are used for HTTP serving, ORM, or database. The project is a pure CLI tool.

---

## Architecture & Domain Model

```
┌──────────────────────────────────────────────┐
│  Distribution: CLI · Claude Code skill · GHA  │
├──────────────────────────────────────────────┤
│  UI: terminal · TUI · markdown/json reports   │
├──────────────────────────────────────────────┤
│  Runtime: event bus · registries · config     │
├──────────────────────────────────────────────┤
│  Pipelines: parallel/sequential · budget      │
├──────────────────────────────────────────────┤
│  Reviewers (Persona+Provider) | Consensus     │
├──────────────────────────────────────────────┤
│  Provider adapters (8 built-in)              │
├──────────────────────────────────────────────┤
│  Core: types, schemas, pure logic — no I/O    │
└──────────────────────────────────────────────┘
```

**Dependencies point downward only.** `core/` imports nothing from the project. `providers/` imports from `core/`. UI imports from runtime events.

### Key domain vocabulary

| Term | Meaning |
|---|---|
| **Provider** | A registered runtime that can review diffs (OpenRouter, Claude Code, etc.). Owns auth, transport, model dispatch. |
| **Model** | A string identifier + per-call params (temperature, max tokens). Lives inside provider config. |
| **Persona** | A system prompt + role declaration + optional output schema hint. Defined in `quorum.yaml`. |
| **Reviewer** | `(Persona, ProviderRef, overrides)` — a persona bound to a provider for execution. |
| **ReviewTask** | Input to a reviewer: diff, files, or prompt + persona-targeted instruction. |
| **Finding** | One issue: `{file, lineRange, severity, category, title, body, reviewer}`. |
| **Pipeline** | A named, ordered or parallel set of reviewers with optional consensus config. |
| **Consensus** | Aggregation, dedup, optional contradiction detection across reviewer results. |
| **EventBus** | Single in-process pub/sub. UIs subscribe; they do not poll. |

### Provider interface (single load-bearing contract)

```ts
interface Provider {
  readonly id: string;
  capabilities(): ProviderCapabilities;
  review?(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult>;
  dispose?(): Promise<void>;
}
```

Providers are registered via `ProviderRegistry` — currently 8 built-in providers registered in `src/runtime/builtins.ts`. External plugin loading is not yet supported.

### Event system

The `EventBus` carries lifecycle events: `pipeline.started`, `reviewer.started`, `reviewer.event`, `reviewer.finished`, `reviewer.failed`, `pipeline.finished`, `pipeline.timeout`, `pipeline.budget_exceeded`, `questions.*`. UI subscribers consume events without blocking execution.

### Consensus strategies (pluggable via `ConsensusRegistry`)

| Strategy | Rule |
|---|---|
| `overlap-v1` | Group by same file + overlapping line range (±2) + same category |
| `majority-v1` | Keep groups meeting strict majority (> n/2, min 2) |
| `severity-aware-v1` | Per-severity agreement thresholds |
| `semantic-v2` | Text-similarity grouping + optional contradiction detection |

---

## Directory Structure

```
quorum/
├── skills/
│   └── review/
│       └── SKILL.md            # Claude Code skill wrapper around the CLI
├── src/
│   ├── ci/
│   │   └── report-check.ts     # GitHub Action report validation
│   ├── cli/
│   │   ├── index.ts            # Single Bun entry point
│   │   ├── args.ts             # Argument parser
│   │   ├── types.ts            # CLI dependency types (for DI/testing)
│   │   ├── report.ts           # Report helpers
│   │   └── commands/
│   │       ├── review.ts       # quorum review
│   │       ├── plan-review.ts  # quorum plan-review
│   │       ├── reviewer.ts     # quorum reviewer add
│   │       └── dashboard.ts    # quorum dashboard
│   ├── config/
│   │   ├── schema.ts           # Zod schemas for quorum.yaml
│   │   ├── loader.ts           # YAML load + validate
│   │   ├── interpolate.ts      # env:VAR / ${VAR} interpolation
│   │   ├── redact.ts           # Secret redaction helpers
│   │   └── sensitive-fields.ts # List of fields to redact
│   ├── consensus/
│   │   ├── registry.ts         # Pluggable strategy registry
│   │   ├── overlap-v1.ts
│   │   ├── majority-v1.ts
│   │   ├── severity-aware-v1.ts
│   │   ├── semantic-v2.ts
│   │   ├── grouping.ts         # Line-range grouping logic
│   │   ├── grouping-v2.ts
│   │   ├── similarity.ts       # Text-similarity helpers
│   │   ├── contradictions.ts
│   │   └── meta-reviewer.ts
│   ├── core/                   # No I/O — pure types + errors
│   │   ├── provider.ts         # Provider interface + ProviderEvent types
│   │   ├── task.ts             # ReviewTask, ReviewResult, ModelConfig
│   │   ├── finding.ts          # Finding, FindingGroup, Severity, Category
│   │   ├── persona.ts
│   │   ├── pipeline.ts         # Pipeline, PipelineResult, ConsensusResult
│   │   ├── events.ts           # EventBus interface + QuorumEvent types
│   │   └── errors.ts           # QuorumError hierarchy
│   ├── interactive/
│   │   └── qa.ts               # Interactive Q&A mode
│   ├── pipelines/
│   │   ├── executor.ts         # PipelineExecutor — runs reviewers, collects results
│   │   └── budget.ts           # Cost budget tracker
│   ├── providers/
│   │   ├── registry.ts         # ProviderRegistry — register + instantiate
│   │   ├── subprocess.ts       # Shared subprocess runner + output normaliser
│   │   ├── base-subprocess.ts  # createSubprocessProvider() factory
│   │   ├── openrouter/         # HTTP provider (API-based)
│   │   ├── ollama/             # HTTP provider (local models)
│   │   ├── claude-code/        # Subprocess provider
│   │   ├── codex-cli/          # Subprocess provider
│   │   ├── gemini-cli/         # Subprocess provider
│   │   ├── kilo-code/          # Subprocess provider
│   │   ├── opencode/           # Subprocess provider (incl. opencode-go alias)
│   │   └── cursor-agent/       # Subprocess provider
│   ├── reviewers/
│   │   ├── reviewer.ts         # BoundReviewer — binds Persona + Provider
│   │   └── output.ts           # Review instruction builders
│   ├── runtime/
│   │   ├── bus.ts              # InMemoryEventBus implementation
│   │   ├── plugin.ts           # PluginCtx type
│   │   ├── runtime.ts          # createRuntime() — wires everything together
│   │   ├── builtins.ts         # registerBuiltins() — registers all providers + consensus
│   │   ├── cache.ts            # Review result caching
│   │   └── workspace.ts        # Git workspace, diff discovery
│   ├── ui/
│   │   ├── terminal.ts         # Terminal progress renderer
│   │   ├── markdown.ts         # Markdown report builder
│   │   ├── json.ts             # JSON report builder
│   │   ├── report-model.ts     # Shared report data model
│   │   └── tui/
│   │       ├── app.tsx         # Ink app root
│   │       ├── reviews-tab.tsx
│   │       ├── pipelines-tab.tsx
│   │       └── utils.ts
│   └── index.ts
├── tests/
│   ├── *.test.ts               # Tests mirroring source concepts
│   └── helpers/
│       └── subprocess.ts       # Fake subprocess runner for tests
├── docs/
│   ├── ARCHITECTURE.md
│   ├── adr/                    # 6 ADRs (MADR format)
│   └── assets/
├── skills/review/SKILL.md
├── action.yml                  # GitHub Action composite definition
├── quorum.yaml.example         # Shareable config template
├── package.json
├── tsconfig.json (strict)
├── biome.json                  # Lint + format config
├── bunnfig.toml
└── Dockerfile                  # Production image (oven/bun:1.3-alpine)
```

---

## Commands

| Command | Description |
|---|---|
| `bun install` | Install dependencies |
| `bun install --frozen-lockfile` | Install with frozen lockfile (for CI) |
| `bun run quorum -- <cmd>` | Run the CLI from source |
| `bun run src/cli/index.ts <cmd>` | Same, direct path |
| `bun test` | Run all tests |
| `bun test <file>` | Run one test file |
| `bun test --coverage` | Run tests with coverage |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `biome check src/ tests/` |
| `bun run format` | `biome check --write src/ tests/` |

**No build step.** Bun runs `.ts` files directly. There is no `dist/` directory.

### CLI subcommands

- `quorum review` — review the current git diff
- `quorum plan-review <file>` — review an implementation plan
- `quorum reviewer add` — add a reviewer to `quorum.yaml`
- `quorum dashboard` — launch the Ink TUI
- `quorum help` — print usage

See `README.md` for detailed flag documentation.

---

## Development Workflow

### Adding a new provider

1. Create `src/providers/<name>/index.ts` and `src/providers/<name>/schema.ts`.
2. Define a Zod config schema and a `ProviderFactory` via `createSubprocessProvider()` (for subprocess CLIs) or by implementing the `Provider` interface directly (for HTTP/SDK providers).
3. Register in `src/runtime/builtins.ts` via `providers.register(factory)`.
4. Add test coverage in `tests/<name>.test.ts`.
5. Document in the README's supported providers table.

### Adding a new consensus strategy

1. Create `src/consensus/<strategy>.ts` implementing `ConsensusStrategy`.
2. Register in `src/runtime/builtins.ts` via `consensus.register(strategy)`.
3. Add the strategy config option to `src/config/schema.ts`.
4. Add test coverage in `tests/consensus.test.ts`.

### Adding a new CLI command

1. Create `src/cli/commands/<name>.ts` with an exported function accepting `CliDeps` and `CliIo`.
2. Add a case in the switch in `src/cli/index.ts`.
3. Add argument parsing in `src/cli/args.ts`.
4. Add tests in `tests/cli.test.ts`.

### Development cycle

```bash
bun install
# make changes
bun run typecheck   # catch type errors first
bun run lint        # catch lint errors
bun test            # run tests
```

---

## Coding Conventions

### TypeScript & imports

- **ESM only.** All files are ES modules (`"type": "module"` in package.json).
- **Include `.ts` in relative imports.** Always: `import { foo } from './bar.ts'`, not `'./bar'`.
- **No barrel files**, no `index.ts` re-exports (except for provider dirs which export their factory).
- Prefer small, typed functions. Use explicit domain types from `src/core/` or local schema modules.
- Destructure, chain, ternaries, and arrow functions are preferred.

### Formatting (Biome enforced)

- 2-space indentation
- Single quotes
- Semicolons always
- Trailing commas on all statements
- Organize imports on format
- No comments in source code unless explicitly requested

### TypeScript config (strict)

The compiler enforces `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. Treat type errors as lint failures.

### File naming

- kebab-case for all files: `openrouter-client.test.ts`, `base-subprocess.ts`, `severity-aware-v1.ts`.
- Test files: `*.test.ts` suffixed (not `.spec.ts`).

### Git conventions

- Short imperative commit subjects, optionally with conventional prefixes: `feat:`, `refactor:`, `docs:`.
- Example: `Type consensus strategy config` or `feat: add provider flag`.
- Do not commit secrets, `quorum.yaml`, `.env`, or `node_modules/`.
- Do not commit without explicit user request.

---

## Testing Guidelines

### Framework & structure

- **`bun:test`** with `describe`, `test`, and `expect`. No Jest, no Vitest.
- Test files are named `*.test.ts` and kept near the behavior they validate.
- Mirror source concepts, not source paths exactly. For example, provider-specific tests can live in `tests/` directly rather than mirroring the `src/providers/` tree.

### What to test

- Config loading and validation (YAML parse, Zod validation, env interpolation)
- Consensus strategies (grouping, agreement thresholds, edge cases)
- CLI argument parsing
- Provider factory creation and basic output normalization
- Report rendering (markdown, JSON, terminal)
- Pipeline executor (parallel/sequential, timeout, budget, partial failure)
- Error types and error formatting

### What NOT to test

- Real HTTP calls or subprocess execution (use DI + fakes)
- Internal implementation details of providers (test the interface contract)
- Full end-to-end with real models

### Test helpers

- `tests/helpers/subprocess.ts` — fake subprocess runner for provider tests.
- Use fake `EventBus`, fake `WorkspaceInfo`, and minimal configs (`MINIMAL_YAML` pattern from `config.test.ts`).

### Running tests

```bash
bun test                    # all tests
bun test tests/config.test.ts  # single file
bun test --coverage         # with coverage
```

---

## CI/CD

Three GitHub Actions workflows in `.github/workflows/`:

### `ci.yml` (push to main + PRs)
- Typecheck (`tsc --noEmit`)
- Test (`bun test`)

### `quorum-review.yml` (PR review)
- Runs the Quorum review action against the PR diff
- Posts a PR comment with findings
- Fails on high-severity findings by default
- Requires `OPENROUTER_API_KEY` secret

### `release.yml` (tags `v*`)
- Typecheck + test
- npm publish
- GitHub release with auto-generated notes

### GitHub Action (`action.yml`)
- Composite action that setups Bun, installs deps, runs `quorum review`, checks the report, and posts a PR comment.
- Inputs: `pipeline`, `config`, `fail_on`, `max_diff_bytes`, `openrouter_api_key`.
- Handles fork PRs gracefully (skip notice when no API key).

---

## Security & Configuration

### Secrets management
- Keep real provider tokens in environment variables.
- Config uses `env:VAR_NAME` (resolved lazily) and `${VAR_NAME}` (resolved at parse time).
- `.env.example` documents required variables. `.env` is gitignored.
- `quorum.yaml.example` is the shareable template. Local `quorum.yaml` may contain machine-specific reviewer settings and MUST NOT be committed.

### Subprocess provider safety
- Provider subprocesses receive a minimal environment plus explicit provider secrets only.
- Provider binaries inside the repository are refused unless the provider config sets `allow_project_binary: true`.
- Subprocess output is size-capped and terminal-rendered text is sanitized.
- `--report` writes inside the repository by default. Use `--allow-report-outside-root` only intentionally.

### Config validation
- Config is validated entirely through Zod schemas in `src/config/schema.ts`.
- Reviewers referencing unknown personas or pipelines referencing unknown reviewers are rejected at load time.
- `requireAgreement` must not exceed the number of reviewers in the pipeline.

### Redaction
- `src/config/redact.ts` provides helpers to redact sensitive fields (API keys, tokens) from config output.
- `sensitive-fields.ts` lists field names to redact.

---

## Important Constraints — Do NOT Modify Without Understanding

| File / Area | Why |
|---|---|
| `src/core/provider.ts` | The `Provider` interface is the central contract. Every provider adapter depends on it. |
| `src/core/events.ts` | `QuorumEvent` types are checked by exhaustive switch in downstream consumers. Adding/removing discriminators breaks all subscribers. |
| `src/core/errors.ts` | Error class hierarchy is used by the CLI's error handler and by provider/pipeline error wrapping. |
| `src/core/finding.ts` | `Severity`, `Category`, `Finding` shape — used by consensus, reports, and consumers. |
| `src/config/schema.ts` | Zod schemas enforce the config shape. Backward-compatible changes only. Schema changes break all existing `quorum.yaml` files. |
| `src/providers/registry.ts` | Provider registration pattern. `instantiate()` handles lazy env resolution + Zod validation. |
| `src/runtime/builtins.ts` | Single place where all providers and consensus strategies are registered. Adding/removing must be intentional. |
| `src/cli/args.ts` | Argument parsing — the skill layer and GitHub Action depend on stable flag parsing. |
| `skills/review/SKILL.md` | Claude Code skill. The argument parsing and CLI resolution order in this file must stay in sync with `src/cli/args.ts`. |
| `action.yml` | GitHub Action composite. Input names and behavior are a public interface. |
| `quorum.yaml.example` | Serves as documentation and bootstrap template. Must parse validly and reflect current config schema. |
| Dependency direction | `core/` must never import from `providers/`, `pipelines/`, `ui/`, or `cli/`. Circular imports will be caught by TypeScript but will cause structural tech debt. |

### Common mistakes to avoid

- **Duplicating domain logic in the skill layer.** The skill (`skills/review/SKILL.md`) must only orchestrate safe CLI execution — no diff parsing, no finding analysis, no consensus computation.
- **Importing without `.ts` extension.** The project is ESM; Bun enforces this.
- **Hardcoding provider types or models.** They are configurable in `quorum.yaml`. The code should reference them as data.
- **Creating barrel files.** Each file should be importable directly; no `index.ts` re-exports except for provider directories.
- **Using `process.exit()` in library code.** Only `src/cli/index.ts` (the entry point) should call `process.exit()`.

---

## AI Agent Instructions

### When working on Quorum

1. **Always use the CLI for operational tasks.** Use `bun run src/cli/index.ts review` (or the resolved CLI per the skill's discovery order) to run reviews. Do not replicate domain logic from `src/` in agent scripts.

2. **For adding reviewers**, use `quorum reviewer add` with the appropriate flags rather than editing `quorum.yaml` manually — unless the user explicitly asks you to hand-edit the config.

3. **After modifying the codebase**, always run:
   ```bash
   bun run typecheck && bun run lint && bun test
   ```
   Type errors are treated as lint failures.

4. **When reading reports**, the latest review is at `.quorum/last-review.md`. Archived timestamped reports live in `.quorum/reviews/`. JSON reports are written to the `--report` path.

5. **Do not rewrite, summarize, or invent findings** from Quorum output. The skill layer returns exact CLI/report output. If you see a Markdown report, return it verbatim inside a fenced block.

6. **For provider additions**, follow the pattern in `src/providers/opencode/index.ts` or `src/providers/openrouter/index.ts`:
   - Subprocess CLI → use `createSubprocessProvider()` from `base-subprocess.ts`
   - HTTP API → implement the `Provider` interface directly
   - Register in `src/runtime/builtins.ts`

7. **For new subprocess providers**, the provider's schema must include `binary`, `allow_project_binary`, `timeout_ms`, and provider-specific fields. See existing schemas in `src/providers/*/schema.ts`.

8. **Never commit secrets or local config.** Do not stage or track `quorum.yaml` or `.env` files.

9. **Respect the dependency direction.** `core/` imports nothing. UI depends on runtime events. CLI depends on everything but should stay thin.

10. **When creating provider tests**, use `tests/helpers/subprocess.ts` fakes and minimal config strings (see `tests/config.test.ts` for the `MINIMAL_YAML` pattern).
