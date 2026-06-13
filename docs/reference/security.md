# Security Model

Quorum treats diffs as untrusted prompt input, but local agent providers still execute local CLI binaries. Use local providers only in repositories and configs you trust.

## Subprocess provider safety

- Subprocess provider output is size-capped and terminal-rendered text is sanitized.
- Provider subprocesses receive a minimal environment plus explicit provider secrets only.
- Provider binaries inside the repository are refused unless that provider config sets `allow_project_binary: true`.
- `--report` writes inside the repository by default. Use `--allow-report-outside-root` only when you intentionally want an external report path.
