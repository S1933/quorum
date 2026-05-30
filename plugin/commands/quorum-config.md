---
name: quorum-config
description: Show or update the loaded Quorum configuration.
argument-hint: "[show | add reviewer <id> <persona/profile>]"
allowed-tools: Bash(git rev-parse:*), Bash(command -v:*), Bash(test:*), Bash(bun run:*), Bash(quorum config:*), Bash(cat:*), Read, Edit, MultiEdit
---

Show the Quorum config, or update `quorum.yaml` when the user asks to add a reviewer/persona.

Raw arguments: `$ARGUMENTS`

Supported intents:
- Show config: no arguments, `show`, `print`, `affiche`, `montre`, or any request to inspect config.
- Add reviewer: requests like `ajoute moi un reviewer qui s'appelle XXX et qui est senior backend`.

Steps:
1. Resolve the target project root with `git rev-parse --show-toplevel`.
2. Keep the command working directory on that target root; do not `cd` into the Quorum plugin repo.
3. Resolve the Quorum CLI in this order:
   - If `QUORUM_CLI` is set, use it.
   - Else if `quorum` is on `PATH`, use `quorum`.
   - Else if `../quorum/src/cli/index.ts` exists from the target root, use that path.
   - Else fail with a clear message asking the user to set `QUORUM_CLI=/absolute/path/to/quorum/src/cli/index.ts`.
4. For show config, invoke:
   - `bun run "$QUORUM_CLI" config --config "$TARGET_ROOT/quorum.yaml"` when using a `.ts` CLI path.
   - `quorum config --config "$TARGET_ROOT/quorum.yaml"` when using the installed binary.
5. Display the output. Secrets are already redacted by the CLI.
6. If the user asks to add a reviewer:
   - Read `$TARGET_ROOT/quorum.yaml`.
   - Read the example config from the Quorum repo in this priority order:
     1. If `QUORUM_CLI` is an absolute `.ts` path, use the repo root two directories above it and read `quorum.yaml.example`.
     2. Else if `$TARGET_ROOT/../quorum/quorum.yaml.example` exists, read it.
     3. Else if `$TARGET_ROOT/quorum.yaml.example` exists, read it.
     4. Else continue with only the current project config and tell the user the example config was unavailable.
   - Find the requested profile/persona in the example config first. Match by persona id and description, including natural-language aliases:
     - `security`: security, securite, adversarial, audit secu
     - `backend-senior`: backend, back-end, senior backend, engineer backend
     - `frontend-senior`: frontend, front-end, senior frontend, UI
     - `architecture`: architecture, architecte, maintainability, maintenabilite
     - `performance`: performance, perf, scalability, latence
   - If a matching example persona exists, copy its full `personas.<id>` block, especially the exact `system` prompt. Do not invent or summarize that prompt.
   - If the target config already has that persona id, reuse it and do not duplicate the `personas` entry.
   - If the target config does not have it, add the persona from the example config under the same id.
   - If no example persona matches, ask the user for the missing system prompt before editing.
   - Add the reviewer under `reviewers` with the user-requested id/name. The reviewer must reference the matched persona id.
   - Choose provider as follows:
     1. If the user names a provider id, use it.
     2. Else if exactly one provider exists in `providers`, use it.
     3. Else if the default pipeline has reviewers, reuse the provider from the first reviewer in that pipeline.
     4. Else ask the user which provider id to use.
   - If the reviewer id already exists, ask before overwriting.
   - Add the reviewer id to `pipelines.<defaults.pipeline>.reviewers` when `defaults.pipeline` exists; otherwise add it to `pipelines.default.reviewers` if present. Do not create a new pipeline unless the user asks.
   - Preserve existing YAML structure and unrelated comments as much as possible.
   - After editing, run the config command from step 4 to validate and show the redacted config.
7. If the user asks "why is X provider missing?", point at the resolved config path and the `providers:` block.
