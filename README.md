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
| 🟢 → | OpenCode | `opencode` |
| 🟢 → | Ollama | `ollama` |

## Requirements

- [Bun](https://bun.sh) `>= 1.1`

## Install

```bash
git clone https://github.com/S1933/quorum.git
cd quorum
bun install && bun link
```

## Use Quorum CLI

### Initialize your project

Run anywhere in your repo. If no `quorum.yaml` exists, the first command copies `quorum.yaml.example`.

### Commands

#### Add a reviewer

```
quorum reviewer add \
  --provider=<type> \
  --persona=<name> \
  --model=<model> \
  [flags]
```

| Flag | Description |
|------|-------------|
| `--provider` *required* | `openrouter`, `claude-code`, `codex-cli`, `continue-dev`, `cursor-agent`, `gemini-cli`, `kilo-code`, `opencode`, `ollama` |
| `--persona` *required* | Persona defined in `quorum.yaml` |
| `--model` *required* | Model for this provider (see examples above) |
| `--id` | Custom reviewer ID (default: `<name>-<persona>-<provider>`) |
| `--ext`, `--fileExtensions` | File extension filter, comma-separated (e.g. `ts,tsx`) |
| `--temperature` | Reviewer model temperature override, from `0` to `2` |
| `--pipeline` | Target pipeline (default: `defaults.pipeline`, then `default`) |
| `--config` | Path to `quorum.yaml` (default: `./quorum.yaml`) |

```bash
# OpenRouter
quorum reviewer add \
  --provider=openrouter \
  --persona=security \
  --model=anthropic/claude-sonnet-4

# Claude Code
quorum reviewer add \
  --provider=claude-code \
  --persona=security \
  --model=sonnet

# Codex CLI
quorum reviewer add \
  --provider=codex-cli \
  --persona=security \
  --model=gpt-5-codex

# Continue.dev
quorum reviewer add \
  --provider=continue-dev \
  --persona=security \
  --model=claude-sonnet-4

# Cursor Agent CLI
quorum reviewer add \
  --provider=cursor-agent \
  --persona=security \
  --model=composer-2.5-fast

# Gemini CLI
quorum reviewer add \
  --provider=gemini-cli \
  --persona=security \
  --model=gemini-2.5-pro

# Kilo Code CLI
quorum reviewer add \
  --provider=kilo-code \
  --persona=security \
  --model=anthropic/claude-sonnet-4

# OpenCode
quorum reviewer add \
  --provider=opencode \
  --persona=security \
  --model=opencode-go/deepseek-v4-pro
# Legacy configs using provider type opencode-go are still accepted.

# Ollama
quorum reviewer add \
  --provider=ollama \
  --persona=security \
  --model=qwen2.5-coder
```

```bash
quorum reviewer add \
  --provider=claude-code \
  --persona=backend-senior \
  --model=sonnet \
  --fileExtensions=go \
  --temperature=0.2 \
  --id=backend-go-reviewer \
  --pipeline=default
```

#### Run a review pipeline

```
quorum review [--pipeline=<id>] [flags]
```

| Flag | Description |
|------|-------------|
| `--pipeline` | Pipeline to run (overrides positional) |
| `--base` | Git ref to diff against (auto-detects `origin/main`) |
| `--format` | Output format: `text` | `json` (default: `text`) |
| `--json` | Shorthand for `--format json` |
| `--report` | Write report to file |
| `--allow-report-outside-root` | Permit `--report` paths outside the git repository |
| `--include` | Comma-separated glob patterns to include |
| `--exclude` | Comma-separated glob patterns to exclude |
| `--max-diff-bytes` | Clip diff to byte budget |
| `--no-color` / `--no-preview` | Quiet terminal output |
| `--config` | Path to `quorum.yaml` |

```bash
quorum review                                       # default pipeline
quorum review --pipeline ci                         # named pipeline
quorum review --json                                # JSON to stdout
quorum review --json --report .quorum/review.json   # JSON to file
quorum review --base origin/main                    # specific git ref
quorum review --include "src/**/*.ts"               # filter by glob
quorum review --no-preview --no-color               # quiet mode
```

#### List personas, reviewers, and pipelines

```
quorum reviewers [--config=<path>]
```

#### Install a git pre-commit hook

The hook blocks commits with `critical` or `high` findings. Bypass with `QUORUM_BYPASS=1`.

```
quorum pre-commit true|false [--pipeline=<id>]
```

```bash
quorum pre-commit true
quorum pre-commit true --pipeline ci
quorum pre-commit false
```

## CI Integration

Add the Quorum GitHub Action to your workflows to review every PR.

### 1. Add a `ci` pipeline to `quorum.yaml`

CI pipelines must use API-based providers (OpenRouter). Subprocess CLIs (`claude-code`, `gemini-cli`, etc.) are not available in GitHub Actions runners.

```yaml
reviewers:
  ci-security:
    persona: security
    provider:
      type: openrouter
      model: anthropic/claude-sonnet-4
      api_key: env:OPENROUTER_API_KEY
  ci-backend:
    persona: backend-senior
    provider:
      type: openrouter
      model: anthropic/claude-sonnet-4
      api_key: env:OPENROUTER_API_KEY

pipelines:
  ci:
    parallel: true
    reviewers:
      - ci-security
      - ci-backend
    consensus:
      strategy: severity-aware-v1
```

### 2. Add `OPENROUTER_API_KEY` to your repository secrets

In **Settings > Secrets and variables > Actions**, add `OPENROUTER_API_KEY`.

### 3. Add the workflow

```yaml
# .github/workflows/quorum-review.yml
name: Quorum Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # required for git diff base detection

      - uses: s1933/quorum@v1
        with:
          fail_on: high
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
```

### Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `pipeline` | `ci` | Pipeline ID in `quorum.yaml` |
| `config` | `quorum.yaml` | Path to config file |
| `fail_on` | `critical` | Minimum severity to fail the check (`critical`, `high`, `medium`, `never`) |
| `max_diff_bytes` | `200000` | Clip diff to byte budget |
| `openrouter_api_key` | | OpenRouter API key (required) |

### PR comment

The action posts a single PR comment (updated on each push) with a severity summary and detailed findings. Critical and high findings are expanded by default.

### Fork PRs

GitHub does not pass secrets to fork PRs. The action posts a skip notice instead of failing.

## Consensus

Findings are grouped when they share the same file, line range (±2 lines), and category.
Categories: `security`, `performance`, `architecture`, `correctness`, `style`.
Multiple reviewers get an agreement badge. Findings below the promotion threshold are
reported separately.

## Security model

Quorum treats diffs as untrusted prompt input, but local agent providers still execute
local CLI binaries. Use local providers only in repositories and configs you trust.

- Subprocess provider output is size-capped and terminal-rendered text is sanitized.
- Provider subprocesses receive a minimal environment plus explicit provider secrets only.
- Provider binaries inside the repository are refused unless that provider config sets
  `allow_project_binary: true`.
- `--report` writes inside the repository by default. Use `--allow-report-outside-root`
  only when you intentionally want an external report path.

Three strategies ship today, selected per pipeline via `consensus: { strategy: <id> }`:

| Strategy | Promotion rule |
|---|---|
| `overlap-v1` | Absolute threshold — a group is promoted when at least `requireAgreement` reviewers agree (default 2). |
| `majority-v1` | Strict majority — a group is promoted when more than half of the reviewers that ran agree. The threshold is derived from the reviewer count (n=3→2, n=4→3, n=5→3), so it stays robust as reviewers are added or removed. It never drops below 2, so a lone surviving reviewer (e.g. when others time out) can't auto-promote its findings; `requireAgreement` raises that floor further. |
| `severity-aware-v1` | Severity-scaled threshold — the agreement bar scales inversely with the group's severity (`critical`/`high`→1, `medium`→2, `low`/`info`→3). A lone reviewer's critical finding is promoted because missing a real critical issue costs more than an occasional false positive, while low-severity noise must clear a broader bar. `requireAgreement` raises the floor for every severity; per-severity overrides via `severityThresholds`. |

Example (`overlap-v1`, default threshold):

- Reviewer A: `src/auth.ts:42`, `security`
- Reviewer B: `src/auth.ts:43`, `security`
- Result: one agreement group, `2 reviewers agreed`
- Reviewer C: `src/db.ts:10`, `performance`
- Result: one single-reviewer finding

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deeper design notes.
