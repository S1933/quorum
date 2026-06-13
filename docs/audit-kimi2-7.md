# Audit technique — Quorum

## Vue d'ensemble

Quorum est un CLI Bun + TypeScript qui orchestre plusieurs reviewers IA sur un diff git et agrège les résultats via un moteur de consensus.
Version auditée : `0.1.0` — ~11 400 lignes de TS (`src/` + `tests/`).
État constaté : `bun run typecheck` ✅ et `bun test` ✅ (247 tests, 0 échec).

---

## 1. Architecture — 8/10

**Points forts**
- Découpage en couches clair : `core/` (types purs), `providers/`, `pipelines/`, `consensus/`, `ui/`, `runtime/`. Les dépendances vont vers le bas, conformément à l'ADR.
- Abstraction `Provider` minimaliste mais extensible via `ProviderFactory` + `ProviderRegistry`.
- Séparation Persona / Reviewer / Pipeline bien respectée.
- Event bus centralisé (`InMemoryEventBus`) qui évite le polling et découplle l'UI du moteur.
- Registres providers/consensus ouverts à l'extension.

**Points faibles**
- `src/runtime/runtime.ts` est un *god module* qui enregistre tous les providers et strategies built-in : pas de mécanisme de plugin externe (admis dans l'ADR comme "out of scope").
- `BoundReviewer` et `ReviewerRef` sont proches ; la distinction pourrait être plus explicite.
- `src/cli/index.ts` exporte des fonctions de commandes pour les tests/intégrations, ce qui est pratique mais couple légèrement la surface CLI au moteur.

**Risques**
- L'interface `Provider` risque de s'ossifier si de nouveaux modes (chat, plan, patch) sont ajoutés sans refactor.
- Le runtime embarque tout en dur : ajouter un provider tiers nécessite de modifier `runtime.ts`.

**Recommandations**
- Introduire un mécanisme de découverte de plugins (convention `@quorum/plugin-*` ou entrée `plugins:` dans `quorum.yaml`).
- Extraire l'enregistrement built-in dans un module `builtins.ts` pour alléger `runtime.ts`.

**Exemple** : `src/runtime/runtime.ts:44-61` enregistre 8 factories et 4 stratégies de consensus.

---

## 2. Qualité du code — 7.5/10

**Points forts**
- TypeScript strict avec `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`. Le compilateur fait office de lint.
- Noms explicites, fonctions courtes, utilisation de `readonly` et de types de discriminated unions (events, consensus configs).
- Gestion des erreurs typée via `QuorumError` et ses sous-classes.
- Parsing de sortie reviewers robuste : extraction JSON, fallback sur balises markdown, scanner d'accolades équilibrées.

**Points faibles**
- Quelques casts forcés : `config as CodexCliConfig` dans plusieurs providers (`codex-cli/index.ts:13`, `claude-code/index.ts:13`, etc.) alors que le schema Zod pourrait valider au runtime.
- Fonctions un peu longues : `buildComment` (`src/ci/report-check.ts:85`), `renderMarkdownReport` (`src/ui/markdown.ts:14`), `runSubprocess` (`src/providers/subprocess.ts:43`).
- Duplication dans les providers subprocess : 6 providers partagent `createSubprocessProvider`, mais chacun répète la logique de `createMetaReviewer` presque identique.
- `parseReportSummary` dans `src/ui/tui/utils.ts:99` parse le markdown avec des regex fragiles.

**Risques**
- Les casts masquent des erreurs de config à l'exécution.
- Le parsing regex du TUI peut casser dès qu'on change le format du rapport.

**Recommandations**
- Valider les configs providers avec Zod avant cast, ou utiliser `z.infer<typeof Schema>` et assertion guard.
- Extraire un helper `createSubprocessMetaReviewer` déjà présent, mais généraliser davantage la construction des args meta.
- Remplacer le parsing regex du dashboard par un modèle structuré (ex: frontmatter YAML dans les rapports).

**Exemple** : `src/providers/codex-cli/index.ts:13` : `const c = cfg as CodexCliConfig;`

---

## 3. Performance — 7/10

**Points forts**
- Exécution parallèle avec limite de concurrence (`maxConcurrency` + `maxConcurrentReviews`).
- Budget coût qui aborte les reviews en cours (`src/pipelines/budget.ts`).
- Diff limité par taille (`maxDiffBytes`) et filtrable par glob.
- Streaming des tokens pour OpenRouter et stdout des subprocess.

**Points faibles**
- Aucun cache : chaque review re-télécharge/recalcule le diff, re-parse la config, réinstancie les providers (bien que `providerCache` dans `runtime.ts` existe, il est scoped à une exécution).
- Le diff entier est passé en string dans le prompt : pas de chunking intelligent.
- `normaliseSubprocessOutput` lit tout en mémoire (capé à 1 Mo, ce qui est correct mais pas optimal pour gros fichiers).
- Pas de rate-limiting actif au-delà des retries OpenRouter.

**Risques**
- Sur de gros repos ou gros diffs, le prompt devient très coûteux en tokens.
- Pas de déduplication des appels si plusieurs reviewers utilisent le même modèle/provider.

**Recommandations**
- Ajouter un cache disque des diffs/prompts/reports.
- Permettre un mode `--files` qui envoie uniquement les fichiers pertinents.
- Évaluer le streaming côté consensus pour ne pas bloquer sur le reviewer le plus lent.

**Exemple** : `src/pipelines/executor.ts:100-112` — parallélisme correct mais sans backpressure réseau.

---

## 4. Sécurité — 7.5/10

**Points forts**
- Refus d'exécuter un binaire local au projet sans `allow_project_binary: true` (`src/providers/subprocess.ts:120`).
- Environnement subprocess réduit à une allowlist (`DEFAULT_ENV_ALLOWLIST`) + secrets explicites.
- Diff encadré par des balises avec message "untrusted input".
- Redaction des secrets dans les logs/configs (`src/config/redact.ts`).
- Échappement markdown dans les rapports et commentaires PR.
- `--allow-report-outside-root` opt-in.

**Points faibles**
- Aucune validation du contenu du diff avant injection dans le prompt (hormis la longueur). Prompt injection possible si le diff contient des instructions.
- `buildSubprocessEnv` filtre `process.env` mais ne nettoie pas les variables sensibles hors allowlist.
- Le CLI subprocess lit `stdin` du terminal ; en mode interactif, les réponses utilisateur sont sanitizées (`sanitizeUserAnswer`) mais la limite de 2000 caractères est arbitraire.
- Pas de vérification de l'origine des binaires providers.
- `action.yml` passe `--config '${{ inputs.config }}'` dans un shell bash sans échappement des quotes (risque d'injection si `inputs.config` est contrôlé).

**Risques**
- Prompt injection via diff malveillant.
- Fuite de secrets si une variable d'env sensible est injectée par un provider.
- Injection de commande shell dans la GitHub Action si `config` est manipulé.

**Recommandations**
- Ajouter un nettoyage des balises d'instruction dans le diff (`<instruction>`, ``` ``` ```, etc.).
- Sanitiser les inputs passés au shell dans `action.yml` (quoting robuste ou passer par des variables d'env).
- Ajouter une option pour auditer l'environnement injecté dans les subprocess.

**Exemple** : `src/providers/subprocess.ts:28-41` allowlist OK, mais `src/providers/subprocess.ts:142-152` ne vérifie pas la nature des `extra`.

---

## 5. Tests — 8/10

**Points forts**
- 247 tests passent, couverture globale très bonne.
- Tests par domaine : consensus, config, providers individuels, pipeline, workspace, CLI.
- Bon usage de l'injection de dépendances (faux providers, `InMemoryEventBus`, `CliDeps`).
- Tests des cas limites : timeout, budget, erreurs partielles, concurrence.
- Tests de sécurité subprocess (binaires locaux, env allowlist).

**Points faibles**
- TUI/dashboard : couverture 0% (`src/ui/tui/app.tsx`, `pipelines-tab.tsx`, `reviews-tab.tsx`, `utils.ts`).
- Mode interactif Q&A : couverture 5,41% (`src/interactive/qa.ts`).
- Quelques tests dupliqués dans `tests/config.test.ts` (lignes 128-130 vs 174-176, 144-156 vs 178-190).
- Certains tests subprocess appellent de vrais binaires (`codex`, `claude`, etc.) — ils sont mocked mais certains prennent 200 ms+.

**Risques**
- Régression sur le dashboard non détectée.
- Dette de tests dupliqués à nettoyer.

**Recommandations**
- Ajouter des tests unitaires pour `src/ui/tui/utils.ts` (parsing de rapports, extraction pipelines).
- Tester `cmdDashboard` avec un mock d'`ink`.
- Dédoublonner les tests dans `config.test.ts`.

**Exemple** : couverture `src/interactive/qa.ts: 0.00% | 5.41%`.

---

## 6. Documentation — 8.5/10

**Points forts**
- README détaillé avec exemples de prompts et commandes.
- `docs/ARCHITECTURE.md` complet : principes, modèle de domaine, ADRs.
- ADRs numérotées (`docs/adr/0001-...`).
- `AGENTS.md` avec conventions de code.
- Exemple de config (`quorum.yaml.example`) très commenté.
- Skill Claude Code documenté (`skills/review/SKILL.md`).

**Points faibles**
- Pas de documentation API générée (TypeDoc) ni de docs en ligne.
- Pas de guide de contribution détaillé au-delà de l'ADR.
- Aucune documentation sur le modèle de menaces / sécurité (hors section README courte).
- Pas de changelog.

**Risques**
- Onboarding d'un nouveau dev dépend fortement de la lecture de `ARCHITECTURE.md`.

**Recommandations**
- Ajouter un `CONTRIBUTING.md` autonome.
- Générer une doc API avec TypeDoc.
- Créer un `CHANGELOG.md`.

---

## 7. DevOps — 6/10

**Points forts**
- CI GitHub Actions fonctionnelle (`typecheck` + `test` + action Quorum).
- `bun.lock` commité.
- Version Bun pinnée (`1.3.3` dans CI et action).
- `action.yml` composite réutilisable.

**Points faibles**
- **Pas de Dockerfile** : le projet dépend de Bun installé sur la machine.
- Pas de conteneurisation pour le développement.
- Pas d'environnement de staging/PR preview.
- Pas de monitoring, métriques, ni telemetry.
- Pas de log structuré : seulement `console.log` dans `report-check.ts` et écriture sur `stderr/stdout`.
- Pas de release automation, ni de semantic versioning au-delà du `0.1.0`.
- `bunfig.toml` désactive `exact` ce qui peut introduire de la dérive mineure de versions.
- Pas de linting (ESLint/Biome/Prettier) : seul `tsc --noEmit` est utilisé.

**Risques**
- Environnement de dev non reproductible sans Bun.
- Mauvaise visibilité en production (pas de métriques sur les échecs, coûts, latences).

**Recommandations**
- Ajouter un `Dockerfile` pour le runtime CLI.
- Introduire un linter (Biome ou ESLint) et un formateur.
- Ajouter des métriques/monitoring (temps de review, taux d'erreur, coût par pipeline).
- Automatiser les releases avec GitHub Releases + tags.

**Exemple** : `.github/workflows/ci.yml` est minimal (33 lignes) et ne produit pas d'artefact.

---

## 8. Maintenabilité — 7.5/10

**Points forts**
- Architecture modulaire facilitant l'ajout de providers/consensus.
- Types stricts qui attrapent beaucoup d'erreurs à la compilation.
- Tests de régression présents.
- Code mort régulièrement retiré (voir git log : "Remove dead provider cleanup code", "Remove init command").

**Points faibles**
- Quelques modules sont des "god files" (`runtime.ts`, `subprocess.ts`, `report-check.ts`, `workspace.ts`).
- La logique de consensus est éclatée : `grouping.ts`, `grouping-v2.ts`, `similarity.ts`, `contradictions.ts`, `meta-reviewer.ts` — frontières pas toujours évidentes.
- CLI commands mêlent parsing, orchestration et rendering.
- `quorum.yaml` local est dans `.gitignore` mais pas de mécanisme de validation de la config utilisateur au runtime autre que Zod.

**Risques**
- Ajouter une nouvelle stratégie de consensus nécessite de toucher à plusieurs fichiers.
- Le dashboard TUI non testé est un point de fragilité.

**Recommandations**
- Refactorer `runtime.ts` en `builtins.ts` + `runtime.ts`.
- Créer une façade `ConsensusEngine` qui encapsule grouping + strategies.
- Séparer la couche "use case" de la couche "presentation" dans les commandes CLI.

---

## 9. Standards et bonnes pratiques — 7/10

**Points forts**
- TypeScript strict et ESM.
- Conventions de nommage respectées (kebab-case, `.ts` dans les imports).
- Commits avec prefixes conventionnels (`feat:`, `fix:`, `docs:`).
- Fichiers ADR pour les décisions architecturales.

**Points faibles**
- **Aucun linter/formateur configuré** (`package.json` n'a que `tsc --noEmit` comme "lint").
- Pas de pre-commit hook (explicitement retiré selon le git log).
- Pas de `knip` ou d'outil de détection de code mort automatisé.
- `package.json` ne définit pas `files`, `exports`, ni `types` pour une distribution npm propre.
- La version est `0.1.0` malgré une fonctionnalité très aboutie.

**Risques**
- Style hétérogène possible à long terme sans formateur.
- Difficulté à publier comme package npm.

**Recommandations**
- Ajouter Biome (rapide, compatible Bun) ou ESLint + Prettier.
- Configurer `package.json` pour publication npm (`exports`, `types`, `files`).
- Introduire un hook de pre-commit optionnel (`lefthook` ou `simple-git-hooks`).

---

## 10. Qualité globale — 7.5/10

**Points forts**
- Projet mature pour un v0.1 : architecture solide, tests complets, documentation claire.
- Fonctionnalités bien livrées : 8 providers, 4 stratégies de consensus, rapports, CI, skill.
- Bonnes pratiques de sécurité pour un outil qui exécute des binaires et envoie des prompts.

**Points faibles**
- Manque d'outillage DevOps (Docker, lint, monitoring).
- Parties du code non testées (TUI, Q&A).
- Quelques raccourcis de cast et de parsing fragile.

**Risques**
- Scalabilité du produit sur de gros repos.
- Maintenance long terme si l'équipe grandit sans standards de lint/format.

---

## Score technique global

| Critère | Note |
|---|---|
| Architecture | 8/10 |
| Qualité du code | 7.5/10 |
| Performance | 7/10 |
| Sécurité | 7.5/10 |
| Tests | 8/10 |
| Documentation | 8.5/10 |
| DevOps | 6/10 |
| Maintenabilité | 7.5/10 |
| Standards | 7/10 |
| Qualité globale | 7.5/10 |

**Note finale : 74.5/100**

**Classement : Bon (70-79)**
Projet solide, bien architecturé et testé, mais avec une dette d'outillage DevOps et des zones non couvertes par les tests.

---

# Top 10 des problèmes les plus critiques

| # | Impact | Problème | Difficulté | Gain attendu |
|---|---|---|---|---|
| 1 | 🔴 Critique | **Pas de linter / formateur** — seul `tsc` vérifie le code. Risque de divergence de style et d'erreurs non détectées. | Facile | Qualité et cohérence du code à long terme. |
| 2 | 🔴 Critique | **Dashboard TUI et mode Q&A non testés** (0% couverture). Régression très probable. | Moyenne | Fiabilité des interfaces utilisateur. |
| 3 | 🟠 Important | **Injection shell possible dans `action.yml`** (`--config '${{ inputs.config }}'`). | Facile | Sécurité CI. |
| 4 | 🟠 Important | **Casts forcés sur les configs providers** (`config as XConfig`). Masquent les erreurs de validation runtime. | Moyenne | Robustesse à la configuration. |
| 5 | 🟠 Important | **Pas de Dockerfile / environnement reproductible**. Dépendance à Bun installé manuellement. | Facile | Onboarding et déploiement. |
| 6 | 🟠 Important | **Pas de cache** : chaque review re-parse tout. Coût et latence inutiles. | Moyenne | Performance et coût. |
| 7 | 🟡 Moyen | **`parseReportSummary`** parse le markdown avec des regex fragiles. | Facile | Fiabilité du dashboard. |
| 8 | 🟡 Moyen | **Tests dupliqués** dans `tests/config.test.ts`. | Facile | Maintenabilité des tests. |
| 9 | 🟡 Moyen | **`bunfig.toml` avec `exact = false`** — risque de dérive de versions. | Facile | Reproductibilité des builds. |
| 10 | 🟢 Mineur | **Pas de changelog / release automation**. | Facile | Traçabilité et adoption. |

---

# Quick Wins (< 1 jour)

1. **Ajouter Biome** (lint + format) et un script `bun run format` / `bun run lint`.
2. **Corriger le quoting dans `action.yml`** : remplacer `--config '${{ inputs.config }}'` par `--config "$CONFIG"` avec une variable d'env.
3. **Dédoublonner les tests** de `tests/config.test.ts`.
4. **Activer `exact = true`** dans `bunfig.toml` et verrouiller les versions.
5. **Ajouter un `Dockerfile`** minimal basé sur `oven/bun`.
6. **Ajouter des tests unitaires** pour `src/ui/tui/utils.ts` (parsing de rapports).
7. **Créer un `CHANGELOG.md`** et tagger une release `v0.2.0`.

---

# Dette technique

- **Niveau : modéré**. L'architecture est saine, mais l'outillage est en retard.
- **Risque de maintenance : moyen**. Le code est lisible, mais quelques god-files et casts fragilisent les évolutions.
- **Facilité d'évolution : bonne**. Ajouter un provider ou une stratégie est relativement simple grâce aux registres.
- **Facilité d'onboarding : bonne**. README + ARCHITECTURE + ADRs fournissent un bon contexte.

---

# Analyse senior

1. **Est-ce un projet maintenable à long terme ?**
   Oui, à condition de combler les lacunes d'outillage (lint, Docker, tests TUI). L'architecture est solide et le code est propre.

2. **Serais-tu à l'aise pour reprendre ce projet ?**
   Oui. Le domaine est bien modélisé, les tests sont présents, et la documentation est au-dessus de la moyenne.

3. **Est-ce qu'il respecte les standards modernes ?**
   Partiellement. Côté TypeScript et tests, oui. Côté DevOps (lint, conteneurisation, CI/CD avancée, monitoring), il reste du travail.

4. **5 premiers chantiers à lancer**
   1. Outillage : lint/format + pre-commit.
   2. Sécurité CI : corriger `action.yml` et auditer les injections de prompt.
   3. Tests : couvrir TUI et mode interactif.
   4. DevOps : Dockerfile + release automation + monitoring.
   5. Refactor : alléger `runtime.ts` et valider les configs providers avec Zod.

5. **Si tu étais CTO, quelle note globale donnerais-tu ?**
   **74/100 — Bon projet, prêt pour un usage interne, mais pas encore "enterprise-grade".**
   Je le qualifierais de "produit prometteur avec une fondation technique solide" et je demanderais un sprint de consolidation avant une mise en production généralisée.
