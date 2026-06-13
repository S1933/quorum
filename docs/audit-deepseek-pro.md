# 🔍 Audit Technique Approfondi — Quorum v0.1.0

**Projet :** Quorum — Provider-agnostic multi-model consensus review for AI-assisted code changes
**Code source :** 6 424 lignes (75 fichiers) · **Tests :** 5 368 lignes (24 fichiers) · **247 tests** 0 échec · **Typecheck :** clean
**Date :** 13 juin 2026

---

## Score global

| Critère | Note |
|---|---|
| Architecture | 8/10 |
| Qualité du code | 8/10 |
| Performance | 7/10 |
| Sécurité | 9/10 |
| Tests | 8/10 |
| Documentation | 9/10 |
| DevOps | 7/10 |
| Maintenabilité | 8/10 |
| Standards | 9/10 |
| Qualité globale | 8/10 |

**Note finale : 81/100 — Très bon**

---

## 1. Architecture — 8/10

### Points forts
- **Architecture en couches propre** — Core → Providers → Reviewers → Pipelines → Runtime → UI → Distribution. Chaque couche a des responsabilités claires (`src/core/errors.ts:1-61`, `docs/ARCHITECTURE.md:44-60`).
- **Provider abstraction remarquable** — L'interface `Provider` (`src/core/provider.ts`) isole parfaitement chaque backend. Les 9 providers (HTTP + subprocess) sont interchangeables sans modifier le pipeline.
- **Inversion de dépendance** — Injection via `CliDeps` (`src/cli/index.ts:13-43`), `PluginCtx`, `EventBus`. Tout est testable.
- **Event-driven élégant** — Le bus d'événements typé (`src/core/events.ts`, `src/runtime/bus.ts`) découple UI et exécution. Pas de polling.
- **Config YAML Zod-validée** — Schéma strict, discriminated unions pour les stratégies, cross-reference validation (`src/config/schema.ts:62-67`, `loader.ts:50-80`).
- **Provider Registry extensible** — Pattern factory + registry (`src/providers/registry.ts`). Ajouter un provider = schéma + factory, sans toucher le core.

### Points faibles
- **Global mutable state implicite** — `process.cwd()` hardcodé dans `findConfigPath` (`src/config/loader.ts:82-84`) et `inferRepoRoot` (`src/runtime/workspace.ts:282-293`). Le `main()` passe par défaut `process.argv.slice(2)` (`src/cli/index.ts:64`).
- **Le runtime est un god-object** — `createRuntime()` (`src/runtime/runtime.ts:44-102`) enregistre providers, consensus, gère le cache, résout reviewers et pipelines — 4 responsabilités distinctes.
- **Pas de séparation entre init et runtime pour les providers** — Les providers subprocess n'ont pas de phase de validation séparée — la config est validée à l'instanciation.

### Risques
- L'ajout d'un nouveau mécanisme d'événement (ex: hooks) nécessiterait de toucher Runtime, PipelineExecutor et tous les consumers.
- Si le nombre de providers > 20, le `runtime.ts` deviendra un point de friction.

### Recommandations
- Extraire la résolution de pipeline/reviewer dans un `PipelineResolver` ou `DependencyGraph`.
- Injecter `cwd` dans `findConfigPath` plutôt que de hardcoder `process.cwd()`.
- Ajouter un `ProviderRegistry.fromDefaults()` pour découpler l'enregistrement du runtime.

---

## 2. Qualité du code — 8/10

### Points forts
- **Typage strict exemplaire** — `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` dans `tsconfig.json`.
- **Pas de code mort visible** — `noUnusedLocals` + `noUnusedParameters` le garantissent à la compilation.
- **Fonctions courtes et focalisées** — La majorité des fonctions font < 30 lignes. Exemple : `normaliseFinding` (`src/reviewers/output.ts:176-200`), `assertTrustedBinary` (`src/providers/subprocess.ts:120-131`).
- **Pas de duplication significative** — La duplication évidente (subprocess providers) est gérée via `createSubprocessProvider` + `base-subprocess.ts`.
- **Patterns cohérents** — Tous les providers suivent le même contrat (interface `Provider`, factory `createSubprocessProvider`).
- **Gestion d'erreur hiérarchique** — `QuorumError` → `ConfigError`, `ProviderInitError`, `ProviderRuntimeError`, `ReviewerExecError`, `ReviewerOutputError`, `CapabilityError`, `DiffBudgetError` (`src/core/errors.ts:1-61`).

### Points faibles
- **Tests dupliqués** — `config.test.ts:174-257` contient des tests dupliqués (lignes 174-190 copie de 144-156, 192-206 copie de 158-172, 229-257 copie de 98-126).
- **Magic strings** — `'***redacted***'` répété sans constante partagée.
- **Complexité du parser JSON** — `extractJsonObject` + `extractBalancedBraces` (`src/reviewers/output.ts:235-270`) est un parser écrit à la main. Bien que fonctionnel, c'est un point de fragilité.
- **`as unknown as` cast** — `src/providers/subprocess.ts:54` (`proc.stdin as unknown as { write... }`) est fragile.

### Risques
- Le parser JSON maison peut avoir des edge cases non couverts (unicode, BOM, etc.).
- Tests dupliqués = maintenance plus lourde si les specs changent.

### Recommandations
- Supprimer les tests dupliqués dans `config.test.ts`.
- Extraire `'***redacted***'` en constante `REDACTED_VALUE`.
- Ajouter des tests de fuzzing pour le parser JSON.

---

## 3. Performance — 7/10

### Points forts
- **Exécution parallèle** — `PipelineExecutor` supporte parallèle/séquentiel avec limite de concurrence (`src/pipelines/executor.ts:155-163`, `200-208`).
- **Streaming** — `OpenRouterClient.chatStream()` (`src/providers/openrouter/client.ts:130-188`) utilise SSE natif sans buffer complet.
- **Budget control** — `BudgetTracker` (`src/pipelines/budget.ts`) suit les coûts token par token et abort si dépassement.
- **Capping stdout/stderr** — Subprocess limité à 1 MB stdout, 64 KB stderr (`src/providers/subprocess.ts:26-27`).
- **Cache de provider** — `providerCache` dans `runtime.ts:63` évite de réinstancier.

### Points faibles
- **Pas de cache de prompt** — Les system prompts sont envoyés à chaque appel LLM sans détection de changement.
- **Pas de streaming pour Ollama** — `OllamaClient` utilise l'API non-streaming.
- **Pas de lazy loading** — Tous les 9 providers sont enregistrés à la création du runtime, même si un seul est utilisé.
- **Pas de compression de diff** — Les diffs sont envoyés bruts aux LLMs, sans résumé/compression.

### Risques
- Coût API élevé si les mêmes diffs sont reviewés plusieurs fois.
- Ollama pourrait bloquer sur de gros outputs.

### Recommandations
- Ajouter un cache de hash de diff pour éviter les re-reviews identiques.
- Ajouter le streaming pour Ollama.
- Enregistrer les providers de manière lazy (seulement ceux utilisés dans le pipeline cible).
- Ajouter une option de résumé de diff pour les changements > 100KB.

---

## 4. Sécurité — 9/10

### Points forts
- **La sécurité est un thème central du projet** — Section "Security model" du README (`README.md:413-423`) démontre une réflexion approfondie.
- **Protection prompt injection exceptionnelle** — `buildSafeFence` (`src/cli/commands/review.ts`) détecte les backticks dans le diff et choisit un délimiteur plus long. `buildFindingsWithQAInstruction` (`src/reviewers/output.ts:308-327`) traite les réponses utilisateur comme untrusted.
- **Redaction des secrets** — `redactConfig` (`src/config/redact.ts:24-42`) + `sensitive-fields.ts` redacte api_key, token, password, secret. Les `LazyEnvRef` sont automatiquement redactées.
- **Env allowlisting** — `buildSubprocessEnv` (`src/providers/subprocess.ts:142-152`) ne passe qu'une allowlist de variables d'environnement aux subprocess.
- **Refus des binaires locaux** — `assertTrustedBinary` (`src/providers/subprocess.ts:120-131`) empêche l'exécution de binaires dans le repo sauf `allow_project_binary: true`.
- **Protection contre path traversal** — `--report` refuse d'écrire hors du repo par défaut.
- **Pas d'injection SQL** — Aucune base de données dans le projet.
- **Gestion propre des secrets** — Support `env:VAR` et `${VAR}` avec résolution lazy (`src/config/interpolate.ts`).

### Points faibles
- **Pas de rate limiting interne** — Seul OpenRouter a un retry (backoff exponentiel), mais pas de rate limiting préventif.
- **Pas de validation des réponses LLM au-delà du parsing JSON** — Pas de sanitization HTML dans les rapports markdown (risque XSS si affiché dans un navigateur).
- **Pas de Content-Security-Policy** pour les outputs TUI/markdown.
- **`readline.createInterface`** — L'interaction Q&A (`src/interactive/qa.ts:73-76`) utilise `readline` sans timeout.

### Risques
- Un reviewer LLM compromis pourrait injecter du HTML/markdown malveillant dans le rapport.
- Pas de mécanisme pour détecter si un reviewer subprocess tente d'accéder au réseau.

### Recommandations
- Sanitizer le HTML dans les rapports markdown avant affichage.
- Ajouter un timeout par question dans le mode Q&A interactif.
- Ajouter un mode `--sandbox` pour les providers subprocess.

---

## 5. Tests — 8/10

### Points forts
- **Couverture solide** — 5 368 lignes de tests pour 6 424 lignes de code = ratio ~0.84. 247 tests, 0 échec.
- **Tests unitaires purs** — La majorité n'a pas d'I/O (fake providers, fake event bus, fake runtime).
- **Dependency injection dans les tests** — `CliDeps` injecté, providers mockés, pas de shell vers de vrais binaires.
- **Tests de sécurité** — `buildSafeFence` testé contre prompt injection, `assertTrustedBinary` testé, `buildSubprocessEnv` testé.
- **Tests de consensus exhaustifs** — `consensus.test.ts` (563 lignes) couvre overlap-v1, majority-v1, severity-aware-v1, semantic-v2, similarity, contradictions.
- **Tests de régression** — `cli.test.ts` (846 lignes) teste le flux complet CLI avec mocks.

### Points faibles
- **Tests dupliqués** — ~30 lignes dupliquées.
- **Pas de tests de performance** — Aucun benchmark pour le pipeline executor, le consensus, ou le parsing JSON.
- **Pas de tests de fuzzing** — Le parser JSON (`output.ts`) mériterait du fuzz testing.
- **Couverture inégale** — `src/ui/tui/` n'a pas de tests dédiés. `src/interactive/qa.ts` pas testé.
- **Pas de tests E2E** — Aucun test qui appelle vraiment `quorum review` via le shell.

### Risques
- Les régressions dans le TUI dashboard ne seraient pas détectées.
- Le parser JSON pourrait casser sur des inputs exotiques non testés.

### Recommandations
- Supprimer les tests dupliqués dans `config.test.ts`.
- Ajouter des tests pour le TUI dashboard.
- Ajouter des tests de fuzzing pour `parseReviewOutput`.
- Ajouter des benchmarks pour la pipeline `aggregate()` sur 100+ findings.
- Ajouter un smoke test E2E.

---

## 6. Documentation — 9/10

### Points forts
- **README excellent** — 427 lignes couvrant installation, quick start, tous les providers, CLI complète, CI, consensus, sécurité.
- **Architecture documentée en profondeur** — `docs/ARCHITECTURE.md` (525 lignes) — design principles, domain model, layer diagram, risks.
- **6 ADRs** — Décisions documentées avec contexte, décision, conséquences. Format standard.
- **AGENTS.md** — Guide pour développeurs (build, test, conventions, sécurité).
- **Commentaires utiles et ciblés** — Pas de commentaires superflus. Ex. `src/reviewers/reviewer.ts:55-58` explique le retry.
- **Exemples concrets** — Section "Prompt examples" pour chaque commande.
- **Schémas et badges** — Diagramme de workflow, badges CI/Bun/TypeScript.

### Points faibles
- **Pas de CONTRIBUTING.md** — Pas de guide pour les contributeurs externes.
- **Pas de CHANGELOG** — Version 0.1.0 sans historique.
- **Pas de documentation API** — Les types exportés (`src/index.ts`) ne sont pas documentés (JSDoc).
- **Le `.env.example` pourrait détailler chaque variable**.

### Recommandations
- Ajouter un `CONTRIBUTING.md` succinct.
- Ajouter JSDoc sur les types exportés dans `src/index.ts`.
- Créer un `CHANGELOG.md` pour la v0.1.0.

---

## 7. DevOps — 7/10

### Points forts
- **Bun lockfile** — `bun.lock` assure des builds reproductibles.
- **CI fonctionnelle** — Typecheck + tests sur push/PR (`ci.yml`).
- **GitHub Action dédiée** — `action.yml` est une composite action bien conçue avec fallback fork PR.
- **Fail-on configurable** — `fail_on: high` permet de graduer la sévérité.
- **Dépendances minimales** — Seulement 3 dépendances runtime (ink, yaml, zod) + React pour le TUI.
- **`.env.example`** — Template clair pour la configuration.

### Points faibles
- **Pas de Dockerfile** — Pas de conteneurisation officielle.
- **Pas de semantic versioning automatisé** — Pas de release workflow.
- **Pas de cache dans le CI** — `bun install` à chaque run sans cache.
- **Pas de test de la GitHub Action** — `action.yml` non testée en isolation.
- **Pas de monitoring/logging centralisé** — Logs uniquement console.
- **Version Bun hardcodée** — `bun-version: "1.3.3"` devrait être `1` pour suivre les patchs.

### Recommandations
- Ajouter `bun-version: "1"` au lieu de `1.3.3`.
- Ajouter le caching Bun dans le CI.
- Créer un `Dockerfile` minimal (2-stage).
- Ajouter un workflow de release avec tags git.
- Tester `action.yml` avec `act` ou un repo de test.

---

## 8. Maintenabilité — 8/10

### Points forts
- **Domain model clair** — Vocabulaire cohérent partout (`docs/ARCHITECTURE.md:29-38`).
- **Interfaces stables** — `Provider`, `EventBus`, `ConsensusStrategy` sont des abstractions solides.
- **Extensible par conception** — Ajouter un provider = implémenter `ProviderFactory`. Ajouter une stratégie de consensus = implémenter `ConsensusStrategy`.
- **Faible couplage** — Les modules core n'importent jamais de modules providers/ui/runtime.
- **Pas de code mort** — Le compilateur l'interdit.

### Points faibles
- **Complexité du runtime** — `createRuntime()` (`src/runtime/runtime.ts`) a trop de responsabilités.
- **Le TUI Ink/React** — Dépendance à React pour un dashboard terminal.
- **Pas de versioning de l'API de config** — `version: 1` mais pas de migration path défini.

### Risques
- Si Ink/React est discontinué, le TUI est bloqué.
- L'ajout d'un consensus complexe pourrait nécessiter des changements dans `PipelineExecutor`.

### Recommandations
- Extraire `createRuntime` en factory + resolver séparés.
- Évaluer si le TUI pourrait utiliser une lib plus légère (blessed, raw ANSI).
- Documenter le plan de migration pour `version: 2` du schéma.

---

## 9. Standards et bonnes pratiques — 9/10

### Points forts
- **TypeScript strict** — Toutes les options strictes activées.
- **ESM partout** — `"type": "module"`, imports avec `.ts`.
- **Zod pour la validation** — Standard moderne pour TypeScript.
- **Conventions cohérentes** — 2-space indent, single quotes, kebab-case, semicolons.
- **Pas de linter externe** — `tsc --noEmit` sert de linter — minimaliste et efficace.
- **6 ADRs** — Format standard pour les décisions architecturales.
- **Git history propre** — Conventional commits.

### Points faibles
- **Pas de Prettier/ESLint/Biome** — Confiance uniquement sur `tsc`.
- **Pas de git hooks** — Pas de pre-commit pour typecheck/test.
- **`verbatimModuleSyntax` désactivé** — `false` dans tsconfig, serait plus strict en `true`.

### Recommandations
- Ajouter `prettier` ou `biome` pour le formatage automatique.
- Ajouter `husky` + `lint-staged` pour pre-commit typecheck.
- Activer `verbatimModuleSyntax: true` (après migration des imports).

---

## 10. Qualité globale — 8/10

Projet mature pour une v0.1. L'architecture en couches, le typage strict, la sécurité by design (prompt injection, redaction, env allowlisting), les tests solides et la documentation complète sont des signes d'un projet mené avec rigueur. Les 247 tests qui passent sans échec et le typecheck clean confirment la qualité d'exécution.

Les axes d'amélioration sont principalement :
1. La duplication de code (tests, magic strings)
2. L'absence d'outillage de formatage
3. Le manque de conteneurisation et de CI avancée
4. La complexité du `Runtime` qui concentre trop de responsabilités

---

## Top 10 des problèmes les plus critiques

| # | Sévérité | Problème | Impact | Difficulté | Gain |
|---|---|---|---|---|---|
| 1 | 🟠 | Absence de conteneurisation (Dockerfile) | Déploiement complexe, onboarding difficile | 2/10 | Standardisation déploiement |
| 2 | 🟠 | Pas de release workflow ni CHANGELOG | Adoption freinée | 3/10 | Versioning automatisé |
| 3 | 🟠 | Pas de sanitization HTML dans les rapports | XSS potentiel | 2/10 | Sécurité renforcée |
| 4 | 🟡 | Tests dupliqués dans `config.test.ts` | Maintenance alourdie | 1/10 | Code plus propre |
| 5 | 🟡 | `Runtime` god-object | Évolutivité réduite | 5/10 | Architecture modulaire |
| 6 | 🟡 | Pas de cache de diff/prompt | Coût API inutile | 4/10 | ~50% réduction coûts |
| 7 | 🟡 | Pas de formatage automatique (Prettier) | Inconsistances de style | 1/10 | Cohérence garantie |
| 8 | 🟡 | `verbatimModuleSyntax: false` | Erreurs subtiles possibles | 3/10 | Sécurité type renforcée |
| 9 | 🟢 | Version Bun hardcodée 1.3.3 | CI fragile | 1/10 | CI résiliente |
| 10 | 🟢 | Absence de benchmarks | Régressions non détectées | 3/10 | Confiance perfs |

---

## Quick Wins (< 1 jour, ROI élevé)

| # | Action | Impact | Durée |
|---|---|---|---|
| 1 | Supprimer les tests dupliqués dans `config.test.ts` | Maintenance | 10 min |
| 2 | Ajouter Prettier + formatage pre-commit | Cohérence | 30 min |
| 3 | Passer `bun-version: "1"` dans CI et action.yml | CI résilience | 5 min |
| 4 | Ajouter cache Bun dans `ci.yml` | CI vitesse | 10 min |
| 5 | Extraire `'***redacted***'` en constante | Maintenance | 5 min |
| 6 | Ajouter un timeout par question dans `qa.ts` | Sécurité | 20 min |
| 7 | Ajouter un `Dockerfile` minimal (2-stage) | Déploiement | 45 min |
| 8 | Créer un `CONTRIBUTING.md` | Onboarding | 20 min |
| 9 | Sanitizer HTML dans `renderMarkdownReport` | Sécurité | 30 min |
| 10 | Ajouter `CHANGELOG.md` pour v0.1.0 | Adoption | 15 min |

---

## Dette technique

- **Niveau :** Faible à modéré
- **Risque de maintenance :** Faible — L'architecture en couches et les interfaces stables protègent contre la dégradation.
- **Facilité d'évolution :** Élevée — Ajouter un provider ou une stratégie de consensus est trivial. Modifier le pipeline est plus risqué.
- **Facilité d'onboarding :** Bonne — AGENTS.md + ARCHITECTURE.md + README complet compensent l'absence de CONTRIBUTING.md.

---

## Analyse senior

### 1. Est-ce un projet maintenable à long terme ?

**Oui.** L'architecture en couches, le typage strict, l'absence de dépendances lourdes (seulement 3 libs runtime), et la documentation complète posent des bases solides. Le principal risque à long terme est le TUI Ink/React qui pourrait nécessiter une migration si l'écosystème évolue défavorablement.

### 2. Serais-tu à l'aise pour reprendre ce projet ?

**Oui, sans hésitation.** Le code est propre, bien typé, testé, et documenté. Productivité possible en moins d'une demi-journée. La seule courbe d'apprentissage est le modèle de domaine (Provider/Reviewer/Pipeline/Consensus), bien expliqué dans l'ARCHITECTURE.md.

### 3. Est-ce qu'il respecte les standards modernes ?

**Très largement.** TypeScript strict, ESM, Zod, Bun runtime, event-driven architecture, YAML config, GitHub Actions CI. Les seules lacunes sont cosmétiques : pas de formateur, pas de semantic release.

### 4. Quels seraient les 5 premiers chantiers à lancer ?

1. **Refactorer `createRuntime`** en `RuntimeFactory` + `PipelineResolver` — démêler les responsabilités.
2. **Ajouter un cache de diff** — réduire les coûts API de ~50% sur les re-runs.
3. **Conteneuriser** — Dockerfile officiel + publication sur GitHub Container Registry.
4. **Ajouter un workflow de release** — `bun publish` + git tags + CHANGELOG automatisé.
5. **Renforcer la sécurité des outputs** — sanitization HTML, CSP pour les rapports.

### 5. Si j'étais CTO, quelle note globale et pourquoi ?

**81/100 — "Très bon, prêt pour la production avec quelques ajustements."**

Ce qui impressionne :
- La maturité du design pour une v0.1 (6 ADRs, architecture en couches, event bus typé).
- L'attention à la sécurité (prompt injection, env allowlisting, binaires locaux bloqués).
- La qualité des tests (247 passants, 0 échec, DI partout).

Ce qui empêche de donner plus :
- Pas de conteneurisation = pas prêt pour du déploiement Cloud natif.
- Pas de release automatisée = adoption freinée.
- Quelques lacunes cosmétiques (tests dupliqués, pas de formateur).

Si ces 3 points étaient réglés, le projet serait à 88-90/100 et mériterait le label **"Excellent — niveau entreprise mature"**.

---

*Audit réalisé le 13 juin 2026 — Projet Quorum v0.1.0 — 6 424 lignes de code source, 5 368 lignes de tests*
