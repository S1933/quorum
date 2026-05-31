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
- YAML-defined personas, reviewer providers, file filters, and parallel or sequential pipelines.
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

## Use Quorum CLI

### Initialize your project

Run anywhere in your repo. If no `quorum.yaml` exists, the first command copies `quorum.yaml.example`.

```bash
# Add your first reviewer — inits config if missing
bun quorum reviewer add --provider=openrouter --persona=security --model=anthropic/claude-sonnet-4

# OpenRouter — uses provider/model format (anthropic/claude-sonnet-4, openai/gpt-5.1-codex...)
bun quorum reviewer add --provider=openrouter --persona=security --model=anthropic/claude-sonnet-4

# Claude Code — uses model nickname (sonnet, opus, haiku)
bun quorum reviewer add --provider=claude-code --persona=security --model=sonnet

# Codex CLI — uses Codex model alias (gpt-5-codex)
bun quorum reviewer add --provider=codex-cli --persona=security --model=gpt-5-codex

# Continue.dev — model is configured in Continue.dev's own config, not via --model
bun quorum reviewer add --provider=continue-dev --persona=security --model=claude-sonnet-4

# Cursor Agent CLI — use "auto" to let Cursor pick the best model
bun quorum reviewer add --provider=cursor-agent --persona=security --model=auto

# Gemini CLI — uses Google model name (gemini-2.5-pro, gemini-2.5-flash)
bun quorum reviewer add --provider=gemini-cli --persona=security --model=gemini-2.5-pro

# Kilo Code CLI — uses provider/model format (anthropic/claude-sonnet-4)
bun quorum reviewer add --provider=kilo-code --persona=security --model=anthropic/claude-sonnet-4

# OpenCode Go — uses opencode-go/ prefix (deepseek-v4-pro, kimi-k2.6, glm-5...)
bun quorum reviewer add --provider=opencode-go --persona=security --model=opencode-go/deepseek-v4-pro

# Ollama — any model available in your local Ollama instance (qwen2.5-coder, llama3.1...)
bun quorum reviewer add --provider=ollama --persona=security --model=qwen2.5-coder
```

### Commands

#### `quorum reviewer add`

Add a reviewer and wire it into a pipeline.

```
bun quorum reviewer add --provider=<type> --persona=<name> --model=<model> [flags]
```

| Flag | Description |
|------|-------------|
| `--provider` *required* | `openrouter`, `claude-code`, `codex-cli`, `continue-dev`, `cursor-agent`, `gemini-cli`, `kilo-code`, `opencode-go`, `ollama` |
| `--persona` *required* | Persona defined in `quorum.yaml` |
| `--model` *required* | Model for this provider (see examples above) |
| `--id` | Custom reviewer ID (default: `<persona>-<provider>`) |
| `--ext` | File extension filter, comma-separated (e.g. `ts,tsx`) |
| `--pipeline` | Target pipeline (default: `default`) |
| `--config` | Path to `quorum.yaml` (default: `./quorum.yaml`) |

```bash
bun quorum reviewer add --provider=claude-code --persona=backend-senior --model=sonnet --ext=go --id=backend-go-reviewer --pipeline=default
```

#### `quorum review [pipeline-id]`

Run a review pipeline on the current diff.

```
bun quorum review [--pipeline=<id>] [flags]
```

| Flag | Description |
|------|-------------|
| `--pipeline` | Pipeline to run (overrides positional) |
| `--base` | Git ref to diff against (auto-detects `origin/main`) |
| `--format` | Output format: `text` | `json` (default: `text`) |
| `--json` | Shorthand for `--format json` |
| `--report` | Write report to file |
| `--include` | Comma-separated glob patterns to include |
| `--exclude` | Comma-separated glob patterns to exclude |
| `--max-diff-bytes` | Clip diff to byte budget |
| `--no-color` / `--no-preview` | Quiet terminal output |
| `--config` | Path to `quorum.yaml` |

```bash
bun quorum review                                       # default pipeline
bun quorum review --pipeline ci                         # named pipeline
bun quorum review --json                                # JSON to stdout
bun quorum review --json --report .quorum/review.json   # JSON to file
bun quorum review --base origin/main                    # specific git ref
bun quorum review --include "src/**/*.ts"               # filter by glob
bun quorum review --no-preview --no-color               # quiet mode
```

#### `quorum reviewers`

List personas, reviewers, and pipelines.

```
bun quorum reviewers [--config=<path>]
```

#### `quorum pre-commit`

Install or remove a git pre-commit hook. The hook blocks commits with `critical` or `high` findings. Bypass with `QUORUM_BYPASS=1`.

```
bun quorum pre-commit true|false [--pipeline=<id>]
```

```bash
bun quorum pre-commit true
bun quorum pre-commit true --pipeline ci
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
