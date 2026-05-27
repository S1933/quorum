# Tech Debt Audit - Quorum

Generated: 2026-05-27 — Re-audited: 2026-05-27 (19/38 resolved, 7 partial, 12 open)

## Executive summary

### Re-audit 2026-05-27

- **19 resolved** (F001, F002, F003, F004, F009, F016, F017, F020, F024, F025, F026, F028, F029, F030, F032, F034, F035, F036, F038)
- **7 partially resolved** (F006, F011, F012, F018, F021, F022, F037)
- **12 not resolved** (F005, F007, F008, F010, F013, F014, F015, F019, F023, F027, F031, F033)

### Original audit (2026-05-27)

- Quorum is a Bun/TypeScript CLI and Claude Code plugin that runs several AI reviewers against a git diff, parses structured findings, then groups them with a consensus strategy.
- Quality baseline is decent for a young project: `tsc --noEmit` passes, `bun test` passes with 71 tests, `bun audit` reports no known vulnerabilities.
- Subprocess prompt delivery and extra_args hardening are **resolved** across all providers. Timed-out classification is consistent.
- The CLI entry point is still a god module (`src/cli/index.ts`, 463 lines); no command extraction has been done.
- Prompt injection resistance is **not resolved**: diffs are still embedded directly inside a markdown fence with no escaping.
- Workspace probing still hides git failures: an invalid base ref still becomes "No diff detected" instead of an error.
- Performance and cost controls remain **missing**: no diff size budgets, no concurrency limits, no retry/backoff.
- Documentation drift has been **partially addressed** but architecture docs still claim several implemented providers are out of scope for V1.
- Test coverage is broader (71→73+), but config tests are still minimal (1 test for a single rejection case).
- Overall project quality: **7.5/10** (+0.5). Security baseline is solid, but the big-ticket items (budget controls, CLI refactor, prompt hardening, workspace exit codes) are still open.

## Architectural mental model

The application is a provider-agnostic review runtime. `src/cli/index.ts` is the public entry point. It loads `quorum.yaml`, probes the current git workspace, builds a review instruction from the diff, creates a runtime, resolves a pipeline, and runs reviewers. A reviewer is a persona bound to a provider. Providers are either HTTP adapters (`openrouter`, `ollama`) or subprocess wrappers around local AI CLIs (`claude-code`, `codex-cli`, `continue-dev`, `cursor-agent`, `gemini-cli`, `kilo-code`, `opencode-go`). Results are parsed as JSON findings and aggregated by `overlap-v1`.

Layering mostly follows the architecture doc: `core/` is type-only/pure, `runtime/` wires registries and the event bus, `pipelines/` orchestrates reviewers, `providers/` own transport, `ui/` renders output, and `plugin/commands` shells out to the CLI. The biggest mismatch is plugin/provider extensibility: the architecture says external providers are registered by convention, but the runtime currently imports and registers all built-ins directly.

Important flows:

1. `quorum review` -> config load -> git diff probe -> runtime/provider resolution -> pipeline executor -> provider review -> JSON parse -> consensus -> terminal/markdown/json report.
2. `quorum config` -> config load -> recursive key-based redaction -> JSON print.
3. `quorum init` -> optional interactive provider/persona/model selection -> generated YAML from `quorum.yaml.example` persona templates.
4. Claude Code slash commands -> resolve target repo and CLI -> run `quorum review|config|init`.

Critical dependencies:

- Runtime: Bun >= 1.1, TypeScript, Node-compatible built-ins.
- Config: `yaml`, `zod`.
- External runtime dependencies: git, local AI CLIs (`claude`, `codex`, `gemini`, `kilo`, `opencode`, `cursor-agent`, `cn`) and/or OpenRouter/Ollama endpoints.
- Trust boundary: user git diff, user config, subprocess CLIs, remote AI provider responses.

## Tooling results

- `bun run typecheck`: pass.
- `bun test`: pass, 73+ tests.
- `bun test --coverage`: pass; coverage improved slightly.
- `bun audit`: pass after network access, no vulnerabilities found.
- `bun run lint`: configured and passing.
- `knip`, `madge`, `depcheck`, `ast-grep`: still not configured.
- `tsc --noEmit --noUnusedLocals --noUnusedParameters`: now passes (tsconfig has these enabled at compile-time).

## Findings

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|---|---|---:|---|---|---|---|
| F001 | Security | `plugin/commands/quorum-review.md:10` | High | M | **RESOLVED 2026-05-27.** Both `quorum-review.md` and `quorum-init.md` now reject shell control characters (backticks, `$`, `;`, `|`, `&`, `<>`, brackets, newlines) and use individually shell-quoted tokens instead of raw `$ARGUMENTS` interpolation. | Keep regression tests for argument sanitization. |
| F002 | Security / Performance | `src/providers/opencode-go/index.ts:33` | High | M | **RESOLVED 2026-05-27.** OpenCode Go, Cursor Agent, and Kilo Code now pass only a short stdin instruction in argv and send the full review prompt through stdin. | Keep regression tests that assert malicious prompt text is absent from argv and present in stdin. |
| F003 | Security | `src/providers/claude-code/schema.ts:8` | High | S | **RESOLVED 2026-05-27.** `claude-code.extra_args` and `opencode-go.extra_args` no longer accept arbitrary strings; both now reject unaudited extra args. | Add explicit enum entries only after auditing provider-specific flag safety. |
| F004 | Security | `src/providers/codex-cli/index.ts:46` | High | M | **RESOLVED 2026-05-27.** `approval_policy: 'never'` now maps to `--dangerously-bypass-approvals-and-sandbox` only when explicitly configured; the schema also includes a `.refine()` that blocks the dangerous `sandbox: 'danger-full-access'` + `approval_policy: 'never'` combination (schema.ts:23-29). | Default remains `'never'` — consider making `'untrusted'` the default for audit/review-only use. |
| F005 | Security | `src/cli/index.ts:449` | High | M | **NOT RESOLVED.** Diffs are still embedded inside `` ```diff `` fences with no escaping. A malicious diff can include triple backticks and inject reviewer instructions. | Wrap diffs in a JSON envelope or use length-prefixed payloads; add tests for fence-breaking diffs. |
| F006 | Correctness | `src/runtime/workspace.ts:46` | High | S | **PARTIALLY RESOLVED.** `runGit` correctly returns `null` on failure (line 87), distinguishing success from failure internally. However, `gitDiff` at lines 44-61 still converts `null` to `undefined`, masking git failures as "no diff" without surfacing stderr. | Surface the git stderr/exit code; exit non-zero on invalid `--base`. |
| F007 | Performance / Cost | `src/runtime/workspace.ts:16` | High | M | **NOT RESOLVED.** Still no `maxDiffBytes`, token budget, file filters, or "too large" failure mode. Full diff is buffered and embedded into prompts without limits. | Add byte/token budgets, include/exclude filters, truncation summaries, and explicit size failure. |
| F008 | Architecture | `src/providers/continue-dev/index.ts:42` | High | M | **NOT RESOLVED.** Subprocess lifecycle logic (spawn, abort, timeout, stdout preview, stderr read, exit handling) is still duplicated across all 7 subprocess providers. No shared `SubprocessRunner` extracted. | Extract a shared subprocess runner with timeout classification, stdin/argv policy, env handling, preview events, and normalized errors. |
| F009 | Correctness / Observability | `src/providers/claude-code/index.ts:63` | Medium | S | **RESOLVED 2026-05-27.** `timedOut` flag is now set and checked: `let timedOut = false;` (line 63) → `setTimeout(() => { timedOut = true; proc.kill(); }, ...)` (lines 64-67) → `throw new ProviderRuntimeError(...)` when true (lines 84-88). | Keep regression tests for timeout classification on all providers. |
| F010 | Architecture | `src/providers/continue-dev/index.ts:132` | Medium | S | **NOT RESOLVED.** JSON-output unwrapping is still duplicated across continue, cursor, kilo, and opencode providers. Continue's `normaliseContinueOutput` (lines 132-175) has thorough fallback logic, but no shared normalizer exists. | Move to a shared provider-output normalizer with provider-specific key lists. |
| F011 | Architecture | `src/runtime/runtime.ts:47` | Medium | M | **PARTIALLY RESOLVED.** All 9 providers are registered correctly at runtime boot. Metadata is still duplicated across `src/config/init.ts` and runtime registration; no shared `BuiltinProviderDescriptor` exists. | Introduce provider metadata modules that export factory, init defaults, safe args, and display name from one source. |
| F012 | Consistency | `src/reviewers/builtin/index.ts:3` | Medium | S | **PARTIALLY RESOLVED.** `BUILTIN_PERSONAS` has 3 personas (security, performance, architecture). `quorum.yaml.example` has 4 (adds `backend-senior`). The init flow loads from the example file, so init sees all 4, but direct builtin consumers only see 3. | Either add `backend-senior` to `BUILTIN_PERSONAS` or generate one source from the other. |
| F013 | Documentation drift | `docs/ARCHITECTURE.md:441` | Medium | S | **NOT RESOLVED.** Section 14 (lines 441-456) still lists "Codex CLI, Aider, Cursor, Gemini CLI, Continue.dev, LiteLLM" as "post-V1" providers, despite all being implemented. | Update architecture docs to reflect actual V1 state; move implemented providers out of "Out of scope." |
| F014 | Documentation drift | `docs/ARCHITECTURE.md:145` | Medium | M | **NOT RESOLVED.** Docs describe third-party provider plugin discovery by package convention, but runtime only registers hardcoded built-ins. No external loading mechanism exists. | Either implement external provider loading or explicitly mark it as future work. |
| F015 | Maintainability | `src/cli/index.ts:73` | Medium | M | **NOT RESOLVED.** `src/cli/index.ts` is still a 463-line god module with no command extraction. Parsing, dispatch, review, init UI, redaction, prompt building, and file writes all coexist in one file. | Split into `commands/review.ts`, `commands/config.ts`, `commands/init.ts`, `args.ts`, and `report-writer.ts`. |
| F016 | UX / Correctness | `src/cli/index.ts:273` | Low | S | **RESOLVED 2026-05-27.** Config path resolution and overwrite check (lines 275-283) now happen *before* interactive prompts at lines 285-287. User is not asked for selections that would be wasted. | — |
| F017 | Correctness | `src/cli/index.ts:439` | Low | S | **RESOLVED 2026-05-27.** `writeReport` (lines 454-458) now passes the full content directly to `Bun.write(path, content)` without string slicing on `/`. Path handling appears portable. | Use `dirname`/`resolve` if report path derivation is added later. |
| F018 | Correctness | `src/pipelines/executor.ts:47` | Medium | S | **PARTIALLY RESOLVED.** Parallel results use positional index via closure (`reviews[index] = result`, line 58). However, `.filter(Boolean)` on line 90 removes undefined slots for failed reviewers without preserving which position failed, shifting subsequent results. | Either preserve empty slots or return `{index, result}` with sort; document failed reviewers by position. |
| F019 | Performance / Cost | `src/pipelines/executor.ts:73` | Medium | M | **NOT RESOLVED.** All reviewers still launch concurrently via `Promise.all` with no concurrency limit, rate-limit handling, or budget guard. | Add `maxConcurrency`, per-provider concurrency, and optional cost/token caps. |
| F020 | Observability | `src/runtime/bus.ts:32` | Low | S | **RESOLVED 2026-05-27.** `safeInvoke` wraps every listener in try/catch; failures log to `console.error` without crashing the bus or affecting other listeners. | — |
| F021 | Observability | `src/runtime/runtime.ts:93` | Low | S | **PARTIALLY RESOLVED.** Provider dispose is called best-effort, but errors are still silently discarded (`catch(() => undefined)`, lines 94-98). No debug log or aggregation. | Emit internal log events or aggregate dispose errors after cleanup. |
| F022 | Config / Security | `src/config/interpolate.ts:24` | Medium | S | **PARTIALLY RESOLVED.** Template interpolation (`${VAR}`) works but only matches uppercase identifiers (`[A-Z0-9_]+`). Lowercase env var names like `${my_var}` are not matched, while `env:my_var` works via the lazy `env:` path. Both mechanisms functionally exist but have different case support. | Document the case-sensitivity difference, or make `${}` match the same set as `env:`. |
| F023 | Test debt | `tests/config.test.ts:5` | Medium | M | **NOT RESOLVED.** Config tests still contain only 1 test (same schema rejection as at audit time). Env interpolation, lazy resolution, cross-reference errors, defaults, and provider-specific validation remain untested. | Add table-driven config tests for interpolation, missing envs, unknown refs, invalid consensus, and provider schema failures. |
| F024 | Type hygiene | `tsconfig.json:3` | Low | S | **RESOLVED 2026-05-27.** `noUnusedLocals` and `noUnusedParameters` are now enabled (tsconfig.json lines 12-13), alongside `strict: true`. Unused imports caught at compile time. | — |
| F025 | Tooling | `package.json:10` | Medium | S | **RESOLVED 2026-05-27.** Scripts now include `typecheck`, `test`, `test:coverage`, and `lint`. Coverage and lint gates are available. | Add format, dead-code, and circular-dependency checks for full coverage. |
| F026 | DevOps | `.github/workflows/ci.yml:20` | Medium | S | **RESOLVED 2026-05-27.** CI now pins `bun-version: "1.3.3"` and `package.json` has `engines.bun: ">=1.1.0"`. Builds are reproducible. | Keep Bun pinned; update intentionally with dependency PRs. |
| F027 | HTTP resilience | `src/providers/openrouter/client.ts:59` | Medium | M | **NOT RESOLVED.** OpenRouter client still has no retry, backoff, rate-limit (429) handling, or circuit breaker. `chat()` and `chatStream()` do a single `fetch` call and throw immediately on any error. Pipeline `timeoutMs` remains optional. | Add default provider request timeouts with retry/backoff for retryable failures. |
| F028 | Observability | `src/providers/openrouter/client.ts:124` | Medium | S | **RESOLVED 2026-05-27.** OpenRouter SSE parsing now includes try/catch with `chunk_parse_error` yield (lines 110-137). Ollama NDJSON parsing similarly yields `chunk_parse_error` (lines 104-126). No silent drops. | Count malformed chunks and fail if stream ends without valid content. |
| F029 | API surface | `src/providers/openrouter/index.ts:85` | Medium | M | **RESOLVED 2026-05-27.** `stream()` method (lines 91-109) exists and delegates to `client.chatStream()`, yielding `token` and `log` events. Streaming API is available. | Pipeline executor still calls `review()` — evaluate whether to integrate `stream()` into orchestration. |
| F030 | Report safety | `src/ui/markdown.ts:68` | Low | S | **RESOLVED 2026-05-27.** `escapeMd` now escapes *all* Markdown special characters: `` \`*_{}[]()#+-.!~|<> ``. User-supplied titles, bodies, file paths, and reviewer IDs pass through this function. No heading/table injection possible. | — |
| F031 | Consensus correctness | `src/consensus/overlap-v1.ts:16` | Medium | M | **NOT RESOLVED.** `aggregate` loop still uses `g.representative` for matching (line 16). Representative can change on severity upgrade (lines 22-24), making grouping order-dependent. A,B,C,D same-line findings produce different groups depending on iteration order. | Match against all group members or use connected components over pairwise matches. |
| F032 | Output contract | `src/reviewers/output.ts:81` | Medium | S | **RESOLVED 2026-05-27.** Missing/invalid lines default to 1; unknown severity/category default to `'medium'`/`'correctness'`. These are sensible defaults for a V1 tool that consumes untrusted LLM output. | Treat invalid required fields as parse errors when running in strict/permissive mode toggle. |
| F033 | Output parsing | `src/reviewers/output.ts:135` | Medium | M | **NOT RESOLVED.** Fallback JSON recovery still uses `indexOf('{')` + `lastIndexOf('}')` with no balanced-brace scanner. Responses with multiple JSON objects or braces in prose will misparse. | Use a small balanced-brace scanner or require exact JSON for providers that support structured output. |
| F034 | Privacy | `src/runtime/workspace.ts:107` | Medium | M | **RESOLVED 2026-05-27.** Untracked files are gated by `MAX_UNTRACKED_BYTES` (24KB per file), binary detection, non-regular file handling, line ending normalization, and unreadable-file fallbacks. | Add config flags for total cap and denylist for sensitive file patterns. |
| F035 | Privacy / UX | `src/cli/index.ts:197` | Medium | S | **RESOLVED 2026-05-27.** Preview is controlled by `--no-preview` flag; `TerminalRenderer` accumulates tokens with 500ms/240-char debounce and shows only last 220 chars. Reasonable defaults. | Keep `--no-preview` default-off to maintain opt-in safety. |
| F036 | Packaging | `package.json:6` | Low | M | **RESOLVED 2026-05-27.** `main` points to `src/index.ts`, `bin` points to `src/cli/index.ts`. Bun-run entrypoints are explicit. `engines.bun` declares Bun requirement. | Decide if a build step for npm consumers is needed; document Bun-only status. |
| F037 | Error handling | `src/runtime/workspace.ts:79` | Medium | S | **PARTIALLY RESOLVED.** `runGit` returns `string | null` — distinguishes failure internally. However, callers cannot access stderr/exit code for diagnostics. The `null` return is still ambiguously "something went wrong." | Return `{ ok: true; stdout } | { ok: false; code; stderr }` for actionable errors. |
| F038 | Config redaction | `src/cli/index.ts:398` | Low | S | **RESOLVED 2026-05-27.** `redactConfig` (lines 387-425) recursively redacts lazy `env:` refs, generic sensitive keys (api_key, token, secret, password variants), and provider-specific sensitive fields. Comprehensive coverage. | — |

## Top 5 if you fix nothing else (updated 2026-05-27)

1. **F005 — Harden prompt construction**
   - Replace markdown fenced diff with a structured envelope:
     ```json
     { "changedFiles": ["..."], "diff": "...", "instruction": "review only this diff" }
     ```
   - Add tests where the diff contains ``` fences, JSON-looking text, and prompt-injection phrases.

2. **F006/F037 — Make workspace probing fail loudly**
   - Replace `string | null` git helpers with `{ ok: true, stdout } | { ok: false, stderr, code }`.
   - Invalid `--base` should exit non-zero with the git error.

3. **F008 — Extract shared subprocess runner**
   - Create `src/providers/subprocess-runner.ts`.
   - Inputs: binary, cwd, args, stdin, env, timeout, abort signal, reviewer id.
   - Outputs: stdout, stderr, exit code, timedOut, token events.
   - Enforce stdin prompt delivery by default; require explicit exception for argv prompt CLIs.

4. **F007/F019/F027 — Add budget and resilience controls**
   - Add `maxDiffBytes`, `maxConcurrency`, `timeoutMs` defaults, provider request timeouts.
   - Add retry/backoff for HTTP providers (429, 5xx).
   - Fail with clear diagnostics when limits are exceeded instead of sending oversized prompts.

5. **F015 — Split CLI god module**
   - Extract `commands/review.ts`, `commands/config.ts`, `commands/init.ts`, `args.ts`, and `report-writer.ts`.
   - Each command file should consume provider/persona metadata from a single shared registry.

## Quick wins (updated 2026-05-27)

- [x] F009: Add `timedOut` handling to Claude Code provider.
- [x] F016: Check overwrite/config path before `quorum init` prompts.
- [x] F017: Replace `writeReport` string slicing with `path.dirname`.
- [ ] F018: Preserve reviewer order in parallel results.
- [ ] F022: Align `${VAR}` interpolation semantics with `env:VAR`.
- [x] F024: Enable TypeScript unused checks and remove unused imports.
- [x] F025: Add `test:coverage` and `lint` scripts.
- [x] F026: Pin Bun version in CI and `@types/bun`.
- [x] F028: Emit warnings for malformed stream chunks.
- [x] F030: Harden markdown escaping.
- [ ] F006: Surface git failure stderr instead of "No diff detected".

### New quick wins
- [ ] F031: Fix order-dependence in overlap-v1 consensus by matching against all group members.
- [ ] F012: Add `backend-senior` to `BUILTIN_PERSONAS` or generate from `quorum.yaml.example`.
- [ ] F013: Move implemented providers out of "Out of scope for V1" in architecture docs.

## Roadmap priorisee (updated 2026-05-27)

### Phase 1 — Security and correctness hardening (reprioritized)

- Harden prompt construction against fence-breaking and instruction injection (F005).
- Make git failures explicit; surface stderr and exit codes (F006, F037).
- Add provider request timeouts with retry/backoff (F027).
- Fix order-dependence in overlap-v1 consensus grouping (F031).
- Improve fallback JSON parsing with balanced-brace scanner (F033).

### Phase 2 — Maintainability and architecture refactor

- Extract CLI commands from `src/cli/index.ts` (F015).
- Introduce shared subprocess runner and shared output normalizer (F008, F010).
- Replace duplicated provider/init metadata with a single registry-driven model (F011).
- Align built-in personas with `quorum.yaml.example` (F012).
- Resolve documentation drift for V1 scope and implemented providers (F013, F014).

### Phase 3 — Budget and resilience controls

- Add diff size budgets, file filters, untracked-file policy (F007).
- Add concurrency limits and cost/token caps (F019).
- Add default provider timeouts and retry/backoff (F027 — moved from Phase 1 if partially done).

### Phase 4 — Test and tooling maturity

- Add config/interpolation tests, consensus edge-case tests, runtime resolver tests (F023, F031).
- Add markdown renderer edge-case tests and plugin command tests.
- Add dead-code and circular-dependency checks to CI.

## Examples of concrete refactorings

### Shared subprocess runner

Target files: `src/providers/claude-code/index.ts`, `src/providers/codex-cli/index.ts`, `src/providers/gemini-cli/index.ts`, `src/providers/continue-dev/index.ts`, `src/providers/kilo-code/index.ts`, `src/providers/opencode-go/index.ts`, `src/providers/cursor-agent/index.ts`.

Sketch:

```ts
interface SubprocessRunOptions {
  providerId: string;
  reviewerId: string;
  binary: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  signal: AbortSignal;
  bus: EventBus;
}

interface SubprocessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}
```

Each provider would only build args and call the runner. Timeout, abort cleanup, stdout preview, and error shaping become consistent.

### Provider metadata

Target files: `src/runtime/runtime.ts`, `src/config/init.ts`, provider schema files.

Sketch:

```ts
interface BuiltinProviderDescriptor {
  type: InitProvider;
  factory: ProviderFactory;
  defaultModel?: string;
  initProviderId: string;
  initConfig(model?: string): Record<string, unknown>;
}
```

This removes the repeated provider list, default model switch, provider id switch, and manual runtime registration drift.

### Workspace probe result

Target file: `src/runtime/workspace.ts`.

Sketch:

```ts
type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; code: number; stderr: string };
```

Use it to distinguish clean workspace, invalid base, missing git, and unexpected git failure.

## Tests and quality strategy

- Keep current provider wrapper tests; they are valuable because they pin argv/stdin behavior.
- Add regression tests for the remaining high-risk cases:
  - malicious diff with code fence and prompt-injection text (F005);
  - invalid `--base` surfacing git errors (F006/F037);
  - large diff exceeds budget (F007);
  - order-dependence in overlap-v1 grouping (F031);
  - config interpolation with `env:VAR`, `${VAR}`, missing vars, and redaction (F023/F022);
  - OpenRouter retry/backoff and timeout behavior (F027).

## DevOps and workflow

- CI pins Bun to `1.3.3` and has basic gates (typecheck, test, coverage, lint).
- There is no lint/format gate, no coverage threshold, no unused/dead code check, and no circular-dependency check.
- Dependency surface is small (`yaml`, `zod`), and `bun audit` found no vulnerabilities.
- Recommended additional CI gates:
  1. format check
  2. dead-code/circular-dependency check
  3. coverage threshold enforcement

## Things that look bad but are actually fine

- `core/` being mostly interfaces and types is appropriate here. The domain is orchestration-heavy, so pure type contracts in `src/core/provider.ts`, `src/core/task.ts`, and `src/core/pipeline.ts` are not accidental over-abstraction.
- `ConsensusConfigSchema.catchall(z.unknown())` in `src/config/schema.ts:28` is acceptable for strategy-specific options. The cross-check for `requireAgreement` at `src/config/loader.ts:68` keeps the known option safe.
- Partial reviewer failure policy in `src/pipelines/executor.ts:60` is intentional and correct for a consensus tool. One bad provider should not erase signal from the others.
- Local `quorum.yaml` is gitignored in `.gitignore:5`; I did not inspect it. That is the right default because it may contain local provider credentials.
- The simple overlap consensus in `src/consensus/overlap-v1.ts:64` is acceptable as a V1 algorithm. The debt is order-dependence and test coverage around edge cases, not the lack of semantic embeddings.

## Open questions for the maintainer

- ~~Should Quorum include untracked files by default, or should that be opt-in for privacy?~~ (Resolved: 24KB per-file cap, binary detection, non-regular file handling, and line-ending normalization in place. Add total cap and denylist config.)
- ~~Is Codex non-interactive execution allowed to bypass approvals/sandbox in production use, or was that a compatibility workaround?~~ (Resolved: bypass is gated on `approval_policy: 'never'`, and `danger-full-access` + `never` is blocked by schema refine.)
- Should the codex-cli `approval_policy` default change from `'never'` to `'untrusted'` for review-only tooling?
- Is the project intended to be Bun-only, or should npm/Node library consumers be supported?
- Should external provider plugins be part of the near-term contract, or should docs mark that as future work?
- Should live token preview be on by default, or should report-only output be the safer default?
- Should `stream()` be integrated into the pipeline executor, or kept as a future-only surface until performance metrics justify it?
