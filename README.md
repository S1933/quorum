# Quorum

![Quorum Workflow](docs/assets/quorum-workflow.png)

[![CI](https://github.com/S1933/quorum/actions/workflows/ci.yml/badge.svg)](https://github.com/S1933/quorum/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/runtime-Bun-000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Provider-agnostic multi-model consensus review for AI-assisted code changes.

Quorum runs multiple AI reviewers on a git diff and highlights findings they agree on — like a team review made only of LLMs.

## Features

- Multi-reviewer consensus on the same git diff, grouped by file, line, and category.
- Provider-agnostic — supports APIs (OpenRouter, Ollama), local models, and agent CLIs (Claude Code, Codex CLI, Gemini CLI, Kilo Code, OpenCode, Cursor Agent).
- YAML-defined personas, reviewers, file filters, and parallel/sequential pipelines.
- Terminal progress + Markdown/JSON reports + archived history in `.quorum/reviews/`.
- Cost breakdown per reviewer (input/output tokens, total cost).
- Interactive TUI dashboard (`quorum dashboard`).

## Supported Providers

| Status | Provider | Type |
|--------|----------|------|
| 🟢 → | OpenRouter | `openrouter` |
| 🟢 → | Claude Code | `claude-code` |
| 🟢 → | Codex CLI | `codex-cli` |
| 🟢 → | Cursor Agent CLI | `cursor-agent` |
| 🟢 → | Gemini CLI | `gemini-cli` |
| 🟢 → | Kilo Code CLI | `kilo-code` |
| 🟢 → | OpenCode | `opencode` |
| 🟢 → | Ollama | `ollama` |

## Quick Start

### 1. Install

```bash
git clone https://github.com/S1933/quorum.git
cd quorum
bun install && bun link
```

### 2. Add a reviewer

Ask your coding agent:

```text
Create my first Quorum reviewer using the security persona,
the OpenRouter provider, and model anthropic/claude-sonnet-4.
```

Equivalent command:

```bash
quorum reviewer add \
  --provider=openrouter \
  --persona=security \
  --model=anthropic/claude-sonnet-4
```

This creates `quorum.yaml` and adds the reviewer to the default pipeline.

### 3. Run a review

Ask your coding agent:

```text
Run Quorum review on the current git diff.
```

Equivalent command:

```bash
quorum review
```

> Prompts mentioning "Quorum" trigger the bundled skill (`skills/review/SKILL.md`) which handles CLI execution and returns exact output. See [`docs/reference/cli.md`](docs/reference/cli.md) for all prompt examples.

## Documentation

| Doc | What's inside |
|-----|---------------|
| [Architecture](docs/ARCHITECTURE.md) | Domain model, layers, interfaces, design decisions |
| [CLI Reference](docs/reference/cli.md) | All commands, flags, examples |
| [Consensus](docs/reference/consensus.md) | Strategies: overlap, majority, severity-aware, semantic |
| [CI Integration](docs/reference/ci.md) | GitHub Action setup, inputs, fork PR handling |
| [Security](docs/reference/security.md) | Subprocess safety, report paths, binary policies |
| [ADR](docs/adr/README.md) | Architecture Decision Records |

## Requirements

- [Bun](https://bun.sh) `>= 1.1`

## Credits

Created by [S1933](https://github.com/S1933). Licensed under MIT.
