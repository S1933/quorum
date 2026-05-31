# Quorum

![Quorum Workflow](docs/assets/quorum-workflow.png)

[![CI](https://github.com/S1933/quorum/actions/workflows/ci.yml/badge.svg)](https://github.com/S1933/quorum/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/runtime-Bun-000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Provider-agnostic consensus review for AI-assisted code changes.

Quorum runs multiple AI reviewers on a git diff and highlights findings they agree on.
Works as a Bun CLI.

## Features

- Multi-reviewer consensus on the same git diff, with findings grouped by file, line, and category.
- Provider-agnostic execution across APIs, local models, and agent CLIs.
- YAML-defined personas, reviewer overrides, file filters, and parallel or sequential pipelines.
- Terminal progress plus Markdown/JSON reports, available from the CLI.

## Supported Providers

| Status | Provider | Type |
|---|---|---|
| 🟢 → | OpenRouter | `openrouter` |
| 🟢 → | Claude Code | `claude-code` |
| 🟢 → | Codex CLI | `codex-cli` |
| 🟢 → | Continue.dev | `continue-dev` |
| 🟢 → | Cursor Agent CLI | `cursor-agent` |
| 🟢 → | Gemini CLI | `gemini-cli` |
| 🟢 → | Kilo Code CLI | `kilo-code` |
| 🟢 → | OpenCode Go | `opencode-go` |
| 🟢 → | Ollama | `ollama` |

## Requirements

- [Bun](https://bun.sh) `>= 1.1`

## Install

```bash
git clone https://github.com/S1933/quorum.git
cd quorum
bun install
```

## Use Quorum CLI in your project

### Initialize your project

Run anywhere in your repo. If no `quorum.yaml` exists, the first command copies `quorum.yaml.example`.

```bash
# Add your first reviewer — inits config if missing
bun quorum reviewer add --provider=openrouter --persona=security --model=claude-sonnet-4-20250514
```

### Commands

**`quorum reviewer add`** — Add a reviewer and wire it into a pipeline.

| Flag | Required | Description |
|------|----------|-------------|
| `--provider <type>` | yes | Provider ID: `openrouter`, `claude-code`, `codex-cli`, `continue-dev`, `cursor-agent`, `gemini-cli`, `kilo-code`, `opencode-go`, `ollama` |
| `--persona <name>` | yes | Persona defined in `quorum.yaml` |
| `--model <model>` | no | Override the provider's model |
| `--id <reviewer-id>` | no | Custom reviewer ID (default: `<persona>-<provider>`) |
| `--ext <ext1,ext2,…>` | no | File extension filter, comma-separated (e.g. `ts,tsx`) |
| `--pipeline <id>` | no | Pipeline to attach to (default: `defaults.pipeline` or `default`) |
| `--config <path>` | no | Path to `quorum.yaml` (default: `./quorum.yaml`) |

```bash
bun quorum reviewer add --provider=claude-code --persona=backend-senior --ext=go --id=backend-go-reviewer --pipeline=default
```

**`quorum review [pipeline-id]`** — Run a review pipeline on the current diff.

| Flag | Description |
|------|-------------|
| `--pipeline <id>` | Pipeline to run (overrides positional) |
| `--base <ref>` | Git ref to diff against (default: auto-detects `origin/main`, `origin/master`, `main`, `master`) |
| `--format text\|json` | Output format (default: `text`) |
| `--json` | Shorthand for `--format json` |
| `--report <path>` | Write report to file |
| `--no-color` | Disable ANSI colors |
| `--no-preview` | Disable live token streaming in terminal |
| `--max-diff-bytes <n>` | Clip diff to byte budget |
| `--include <glob>` | Comma-separated glob patterns to include |
| `--exclude <glob>` | Comma-separated glob patterns to exclude |
| `--config <path>` | Path to `quorum.yaml` |

```bash
bun quorum review                           # run default pipeline
bun quorum review --pipeline ci             # run named pipeline
bun quorum review --json                    # JSON output to stdout
bun quorum review --json --report .quorum/review.json  # JSON to file
bun quorum review --base origin/main        # diff against a specific ref
bun quorum review --include "src/**/*.ts"   # only .ts files
bun quorum review --no-preview --no-color   # quiet terminal output
```

**`quorum reviewers`** — List providers, personas, reviewers, and pipelines.

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to `quorum.yaml` |

```bash
bun quorum reviewers
```

**`quorum pre-commit true|false`** — Install or remove a git pre-commit hook.

The hook runs `quorum review --json` and blocks the commit if any `critical` or `high` severity findings exist. Bypass with `QUORUM_BYPASS=1`.

```bash
bun quorum pre-commit true
bun quorum pre-commit false
```

## Consensus

V1 ships `overlap-v1`.

Findings are grouped when they share the same file, line range (±2 lines), and category.
Categories: `security`, `performance`, `architecture`, `correctness`, `style`.
Multiple reviewers get an agreement badge. Single-reviewer findings are reported separately.

Example:

- Reviewer A: `src/auth.ts:42`, `security`
- Reviewer B: `src/auth.ts:43`, `security`
- Result: one agreement group, `2 reviewers agreed`
- Reviewer C: `src/db.ts:10`, `performance`
- Result: one single-reviewer finding

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deeper design notes.
