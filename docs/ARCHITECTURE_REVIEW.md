# Architecture Review — 10 Deepening Opportunities

Generated from a full audit of `src/`, `tests/`, and `docs/ARCHITECTURE.md`.

Vocabulary: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality. See `skills/improve-codebase-architecture/LANGUAGE.md`.

---

## Top 3 (highest leverage)

### 1. Meta-review uses Provider interface

**Status:** ✅ DONE

**Files:** `src/pipelines/executor.ts`, `src/providers/registry.ts`, `src/providers/subprocess.ts`, 8 providers

**Problem:** `buildMetaReviewArgs()` contained a hardcoded `switch` over 7 provider types (`claude-code`, `codex-cli`, `gemini-cli`, `opencode`, `opencode-go`, `cursor-agent`, `kilo-code`) with binary names and arg shapes. `createMetaReviewFn()` bypassed the entire `Provider` abstraction to spawn raw shell processes with `Bun.spawn()`. Adding a new provider required modifying `executor.ts`.

**Solution:** Added `createMetaReviewer?()` to `ProviderFactory`. Each factory now knows how to invoke itself for meta-review. A shared `createSubprocessMetaReviewer()` helper in `subprocess.ts` wraps `runSubprocess()` into a `MetaReviewFn`. The executor looks up the factory via `ProviderRegistry` and delegates. The 40-line `switch` was deleted.

**Benefits:**
- **Leverage:** Adding a new provider no longer touches executor.ts. One factory method per provider encapsulates its invocation.
- **Locality:** Meta-review logic lives in provider modules, not in pipeline orchestration.
- **Testability:** Inject a fake `ProviderFactory` with `createMetaReviewer` to test the executor's meta-review wiring.

---

### 2. SubprocessProvider base factory — unify the 7 providers

**Files:** 7 provider directories + 7 test files

**Problem:** 7 subprocess providers (`claude-code`, `codex-cli`, `gemini-cli`, `continue-dev`, `kilo-code`, `opencode`, `cursor-agent`) share ~80% identical structure:
- `capabilities()` duplicated 7 times identically
- `review()` body duplicated 7 times with minor variations in `buildArgs()` and `normaliseSubprocessOutput()` calls
- `factory` object duplicated 7 times with just `type` and schema changed
- `PROVIDER_TYPE` constant duplicated 7 times
- `STDIN_PROMPT` constant duplicated 5 times with identical text
- Test files duplicate temp dir setup, mock binary creation, `task()`, `captureBus()`, `tokenText()` helpers

Combined: ~500 lines across 7 providers, ~300 lines across 7 test files.

**Solution:** Introduce a `createSubprocessProvider` base factory that captures the common pattern. Each provider becomes ~10-20 lines declaring its `providerType`, `providerLabel`, `buildArgs()`, and Zod schema. The shared factory handles capabilities, `review()`, `runSubprocess()`, and `parseFindings()`. Tests become one parameterized suite.

**Benefits:**
- **Depth:** ~350 lines deleted. One factory with high leverage replaces 7 shallow copies.
- **Locality:** Changing the subprocess execution flow (byte caps, env, signal handling) happens in one place.
- **Testability:** One test suite covers all subprocess providers with parameterized cases.

---

### 3. Unify ReviewerOverrides/ModelConfig — single type

**Status:** ✅ DONE

**Files:** `src/config/schema.ts:11-18`, `src/core/pipeline.ts:4-9`, `src/core/task.ts:10-15`, `src/runtime/runtime.ts:138-146`, `src/reviewers/reviewer.ts:66-77`

**Problem:** Four representations of the same "reviewer overrides" concept:
1. `ReviewerOverridesSchema` (Zod, `config/schema.ts:11`)
2. `ReviewerOverrides` interface (`core/pipeline.ts:4`)
3. `ModelConfig` interface (`core/task.ts:10`)
4. `toReviewerOverrides()` + `overridesToModelConfig()` transform functions

`ReviewerOverrides` and `ModelConfig` are structurally identical (`temperature?`, `maxTokens?`, `topP?`, `model?`). The transforms `toReviewerOverrides()` and `overridesToModelConfig()` copy field-by-field solely because two otherwise-identical types serve different roles.

**Solution:** Collapsed to a single `ModelConfig` type. Removed `ReviewerOverrides` entirely. Renamed `ReviewerOverridesSchema` → `ModelConfigSchema`. Renamed `toReviewerOverrides()` → `toModelConfig()`. Deleted `overridesToModelConfig()` (became a no-op since `ReviewerRef.overrides` is already `ModelConfig`). `ReviewerConfig.overrides` now uses `ModelConfigSchema`. Field-by-field copy retained in `toModelConfig()` due to `exactOptionalPropertyTypes: true`.

**Benefits:**
- **Depth:** ~30 lines deleted. One type instead of four representations + one transform function eliminated.
- **Locality:** No more field-by-field copying between layers. Change one field, change one type.

---

## Rest of the top 10

### 4. Zod schemas per consensus strategy

**Files:** `src/config/schema.ts:35-40`, `src/consensus/semantic-v2.ts`, `src/consensus/severity-aware-v1.ts`

**Friction:** `ConsensusConfig` uses `.catchall(z.unknown())` and `[key: string]: unknown`. Strategy-specific config is accessed with `as number` casts:
- `cfg.similarityThreshold as number | undefined`
- `cfg.enableContradictions as boolean | undefined`
- `cfg.severityThresholds as Partial<Record<Severity, number>> | undefined`

Typos in config keys (`enableContradiction` vs `enableContradictions`) are silently ignored.

**Solution:** Give each strategy its own Zod schema nested under `cfg.strategyConfig`. Validate at config parse time. Eliminate all `as` casts.

**Benefits:** Catches config typos at startup. Type-safe strategy config access. No `as number` casts in strategy code.

---

### 5. ConfigError with structured `code` field

**Files:** `src/core/errors.ts:8-10`, `src/config/loader.ts`, `src/providers/registry.ts`, `src/consensus/registry.ts`

**Friction:** `ConfigError` is thrown for many distinct failures (parse error, missing persona, unknown type, invalid cross-reference) but carries no structured context. Callers handling `ConfigError` cannot distinguish "bad YAML" from "bad cross-reference" without parsing the message string.

Additionally, `ProviderInitError` (`errors.ts:12`) is defined but never thrown — provider registry throws `ConfigError` for initialization failures.

**Solution:** Add a `code` field: `'PARSE' | 'MISSING_PERSONA' | 'MISSING_REVIEWER' | 'MISSING_PIPELINE' | 'UNKNOWN_PROVIDER' | 'UNKNOWN_STRATEGY'`. Actually throw `ProviderInitError` from `ProviderRegistry.instantiate()`.

**Benefits:** Callers handle errors without string-matching. Better error UX. Proper use of the existing error hierarchy.

---

### 6. Extract severity/icon/glyph helpers to shared module

**Files:** `src/ui/terminal.ts:189-216`, `src/ui/markdown.ts:99-126`, `src/ci/report-check.ts:56-62` (and `src/ci/report-check.ts:6-55` which duplicates `Finding`/`JsonReport` types)

**Friction:** `severityIcon`, `severityLabel`, `categoryIcon`, `formatDuration` are duplicated across 3 modules. `report-check.ts` additionally redefines `Finding`, `JsonReport`, and `SEVERITY_RANK` that already exist in `src/core/finding.ts` and `src/ui/json.ts`.

**Solution:** Create `src/ui/glyphs.ts` with shared icon/label functions. Move `report-check.ts` into the package's `src/` compile pipeline to share types properly.

**Benefits:** ~60 lines deleted. One source of truth for severity rendering. Cross-cutting display changes happen in one place.

---

### 7. Move `buildReviewInstruction()` to core module

**Files:** `src/cli/commands/review.ts:244-257`

**Friction:** `buildReviewInstruction()` and `buildSafeFence()` live in the CLI command handler. They are not independently testable. The prompt construction logic (file list formatting, fence generation, diff wrapping) is a core concern that should not be coupled to CLI I/O.

**Solution:** Extract to `src/core/instruction.ts` as pure functions. Test independently.

**Benefits:** Prompt construction becomes independently testable. CLI command shrinks. Prompt logic reusable across surfaces (CLI, GitHub Action, pre-commit hook).

---

### 8. Move `sensitive-fields.ts` into ProviderFactory

**Files:** `src/config/sensitive-fields.ts:1-11`, `src/config/redact.ts:1-42`

**Friction:** `sensitive-fields.ts` imports from `../providers/openrouter/schema.ts` and `../providers/cursor-agent/schema.ts` — a `config → providers` dependency that breaks the intended layer direction. This 11-line module exists only to avoid a circular import.

**Solution:** Add `sensitiveFields?: Set<string>` to `ProviderFactory`. The registry carries redaction metadata. `redact.ts` takes a `ProviderRegistry` reference instead of hardcoded provider imports.

**Benefits:** Eliminates the config→providers dependency. `sensitive-fields.ts` deleted (~11 lines). Redaction metadata lives where it belongs: in the provider definition.

---

### 9. Remove the `src/core/index.ts` barrel

**Files:** `src/core/index.ts:1-7`

**Friction:** Pure re-export barrel with 7 lines. The root-level barrel `src/index.ts` already re-exports from individual `src/core/*.ts` files directly in most cases. The double-barrel adds an unnecessary indirection.

**Solution:** Delete `src/core/index.ts`. Update `src/index.ts` to import from `src/core/finding.ts`, `src/core/task.ts`, etc. directly.

**Benefits:** 7 lines deleted. Cleaner import graph. One less file to maintain.

---

### 10. Remove or justify `BUILTIN_PERSONAS` export

**Files:** `src/reviewers/builtin/index.ts:1-19`, `src/index.ts:11`

**Friction:** `BUILTIN_PERSONAS` is exported from the public API (`src/index.ts:11`) but never used internally (F005 in tech debt audit). Personas are defined inline in `quorum.yaml.example` and the YAML schema requires explicit persona definitions. These built-ins serve as documentation but have no runtime role.

**Deletion test:** Delete the file and the export. All tests pass. No callers in the library or CLI.

**Solution:** Either remove entirely (dead code), or promote to actual fallback personas that the runtime loads automatically when not overridden in `quorum.yaml`.

**Benefits:** If removed: 1 line deleted from public API surface, no dead exports. If promoted: built-in personas become useful defaults, justifying their existence.
