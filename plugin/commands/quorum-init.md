---
name: quorum-init
description: Create or inspect starter Quorum configuration options for the current project.
argument-hint: "[--provider <type>] [--model <id>] [--personas <ids>] [--force] [--list-providers] [--list-personas]"
allowed-tools: Bash(git rev-parse:*), Bash(command -v:*), Bash(test:*), Bash(bun run:*), Bash(quorum init:*), Bash(cat:*)
---

Create `quorum.yaml` in the user's current project, or list supported init options.

Arguments: `$ARGUMENTS`

Steps:
1. If `$ARGUMENTS` includes `--help`, `--list-providers`, or `--list-personas`, run the corresponding `quorum init` command and return its output without asking setup questions.
2. Resolve the target project root with `git rev-parse --show-toplevel`.
3. Keep the command working directory on that target root; do not `cd` into the Quorum plugin repo.
4. Build `INIT_ARGS` from `$ARGUMENTS`.
5. If `INIT_ARGS` does not include `--provider`, let `quorum init` show checkbox choices for provider(s). The user can move with arrow keys, toggle with Space, and confirm with Enter. Supported providers:
   - `claude-code`
   - `openrouter`
   - `codex-cli`
   - `continue-dev`
   - `cursor-agent`
   - `gemini-cli`
   - `kilo-code`
   - `opencode-go`
   - `ollama`
6. If `INIT_ARGS` does not include `--personas`, let `quorum init` show checkbox choices for personas. The user can move with arrow keys, toggle with Space, and confirm with Enter. Supported personas:
   - `security`
   - `backend-senior`
   - `architecture`
   - `performance`
7. If a single provider is selected and `INIT_ARGS` does not include `--model`, let `quorum init` ask for a model, with the provider default as Enter. Do not pass `--model` with multiple providers.
8. Resolve the Quorum CLI in this order:
   - If `QUORUM_CLI` is set, use it.
   - Else if `quorum` is on `PATH`, use `quorum`.
   - Else if `../quorum/src/cli/index.ts` exists from the target root, use that path.
   - Else fail with a clear message asking the user to set `QUORUM_CLI=/absolute/path/to/quorum/src/cli/index.ts`.
9. Invoke:
   - `bun run "$QUORUM_CLI" init $INIT_ARGS --config "$TARGET_ROOT/quorum.yaml"` when using a `.ts` CLI path.
   - `quorum init $INIT_ARGS --config "$TARGET_ROOT/quorum.yaml"` when using the installed binary.
10. Do not overwrite an existing `quorum.yaml` unless the user passed `--force` or explicitly confirms overwriting. If they confirm, rerun with `--force`.
11. After creation, print the exact CLI output and show the generated `quorum.yaml` content in a fenced `yaml` block.

Failure modes to surface:
- Existing `quorum.yaml`: ask whether to overwrite or stop.
- Missing Quorum CLI: ask the user to export `QUORUM_CLI` or install/link the `quorum` binary.
- Missing provider credentials: mention the needed setup, such as `OPENROUTER_API_KEY` for `openrouter`.
