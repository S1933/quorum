# Audit Technique Complet — Quorum

**Date : 13 juin 2026**
**Projet : Quorum — CLI multi-reviewer code review (Bun + TypeScript)**
**~4 560 lignes source, 61 fichiers, 23 fichiers de test**

---

## 1. Architecture — 8/10

**Points forts :**
- Architecture en couches claire : `core/` (types purs sans I/O) → `providers/` → `pipelines/` → `runtime/` → `ui/` → `cli/`. Les dépendances pointent toujours vers le bas.
- Interface `Provider` unique avec 8 implémentations (2 HTTP, 6 subprocess), chacune via factory pattern. `base-subprocess.ts` évite la duplication pour les 6 providers CLI.
- Bus d'événements typé (`InMemoryEventBus`) découple le rendu de l'exécution.
- 4 stratégies de consensus plug-and-play via registre avec configs union discriminées.
- Injection de dépendances via `CliDeps`/`CliIo` rendant le CLI testable.
- Hiérarchie d'erreurs domain-spécifique (`QuorumError` → `ConfigError`, `ProviderInitError`, etc.)

**Points faibles :**
- `review.ts` (299 lignes) et `plan-review.ts` (156 lignes) dupliquent la logique d'orchestration pipeline, format selection, et report writing. Manque un helper partagé `executePipelineAndWriteReport`.
- Frontière CLI/bibliothèque floue : des utilitaires CLI (`buildReviewInstruction`, `filterReviewersByChangedFiles`, `resolveDiffLimits`) sont ré-exportés dans `src/index.ts`.
- `reviewer.ts` (312 lignes) mélange validation, manipulation YAML, et génération de noms — trop de responsabilités.
- `Provider.review` est optionnel dans l'interface alors que toutes les implémentations le fournissent — devrait être requis pour attraper les erreurs à la compilation.

**Risques :**
- La duplication entre `review.ts` et `plan-review.ts` va diverger avec le temps.
- Le mélange CLI/bibliothèque dans l'API publique freine la réutilisation.

**Recommandations prioritaires :**
1. Extraire un helper `executePipelineAndWriteReport` partagé.
2. Séparer l'API publique (`index.ts`) entre exports CLI et exports library.
3. Rendre `Provider.review` requis dans l'interface.

---

## 2. Qualité du code — 7/10

**Points forts :**
- TypeScript strict avec `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` — excellent.
- Zod pour toute validation de config, avec `.strict()` et `.refine()`.
- Fonctions courtes et typées, noms kebab-case cohérents.
- Unions discriminées pour les configs de consensus et événements — typage exhaustif.
- Gestion d'erreurs domain-spécifique plutôt que des `throw "string"`.

**Points faibles :**
- `grouping-v2.ts` utilise `undefined as unknown as FindingGroup` — cast unsafe.
- `contradictions.ts` duplique `severityRank()` avec un `ranks` hardcodé au lieu d'utiliser celui de `core/finding.ts`.
- `deepEqual` dans `reviewer.ts` réimplémente l'égalité structurelle.
- `dashboard.ts` utilise `process.stdout` directement au lieu du `CliIo` injecté.
- `parseReportSummary` dans `utils.ts` parse le Markdown avec des regex fragiles au lieu d'utiliser les rapports JSON.
- `meta-reviewer.ts` utilise `{reviewerA}` comme placeholder — risque de collision si le contenu contient ces chaînes.

**Risques :**
- Le cast `undefined as unknown as FindingGroup` peut causer des erreurs au runtime si la logique de groupement change.
- Les regex de parsing Markdown casseront silencieusement si le format de rapport évolue.

**Recommandations :**
1. Remplacer le cast unsafe par une construction propre du `FindingGroup`.
2. Réutiliser `severityRank()` de `core/finding.ts` dans `contradictions.ts`.
3. Utiliser les rapports JSON structurés pour le dashboard TUI au lieu de parser le Markdown.

---

## 3. Performance — 6/10

**Points forts :**
- Exécution parallèle des reviewers avec concurrency control (`runWithConcurrencyLimit`).
- Budget tracker pour limiter les coûts cumulés.
- Timeout et abort propagation via `AbortController`.
- Limites de bytes sur stdout/stderr des subprocess (1MB/64KB).
- Throttling du token preview dans le terminal renderer (500ms/240 chars).

**Points faibles :**
- Algorithme de groupement O(n²) dans `grouping.ts` et `grouping-v2.ts` — avec rebouclage `while(changed)` pour le v2. Pour des sets de findings larges, c'est un bottleneck.
- Résolution séquentielle des contradictions par le meta-reviewer — aucune parallélisation.
- Pas de cache de résultats de review — relancer la même review refait tous les appels LLM.
- Client Ollama sans retry (alors qu'OpenRouter en a) — échec réseau unique tue la review.
- Pas d'index ou structure de données optimisée pour la recherche de findings par fichier/ligne.
- `deepEqual` dans `reviewer.ts` fait une comparaison récursive manque-à-mane — utilise `JSON.stringify` ou une lib.

**Risques :**
- Sur un gros diff avec 50+ findings, le consensus O(n²) peut devenir lent.
- L'absence de retry sur Ollama rend les reviews locales fragiles.

**Recommandations :**
1. Ajouter de la retry logic au client Ollama (aligner sur OpenRouter).
2. Paralléliser les appels meta-reviewer pour les contradictions.
3. Considérer un index par `(file, line_start)` pour le groupement.
4. Ajouter un cache optionnel des résultats de review.

---

## 4. Sécurité — 8.5/10

**Points forts :**
- **Allowlist d'env vars** pour les subprocess — seul un sous-ensemble explicite est transmis. Testé dans `cursor-agent.test.ts`.
- **Rejet des binaires projet-local** (`assertTrustedBinary`) — empêche l'exécution de binaires malveillants dans le repo.
- **Passage des instructions via stdin, pas argv** — prévention d'injection de commandes testée pour 5 providers.
- **Rejet des extra_args dangereux** (4 providers : `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, `--trust-all`, `--auto`).
- **Redaction des secrets** en 3 couches : lazy env refs, champs sensibles par schema, heuristiques par nom de clé.
- **Limites de bytes** sur stdout/stderr des subprocess.
- **Sanitisation ANSI** du output terminal — prévient les ANSI injection attacks.
- **Échappement des annotations GitHub Actions** — prévient l'annotation injection.
- **Clôture de sécurité dans les instructions** (`buildSafeFence`) — prévient la rupture de démarcation markdown par le diff.
- **Validation du chemin de rapport** (`assertPathInside`) — prévient le path traversal.
- **Aucun `eval()` ou `new Function()`** dans le codebase.
- **Aucune surface SQL**.

**Points faibles :**
- `process.env` spreadé en entier dans le plugin context (`runtime/plugin.ts`) — ne fuit pas aux subprocess mais brouille la frontière.
- `QUORUM_COMMENT_FILE` non validé dans `report-check.ts` — surface potentielle de path traversal en CI.
- `assertPathInside` ne vérifie pas les symlinks — un symlink sortant pourrait contourner.
- Registry des sensitive fields incomplet — seuls openrouter et cursor-agent ont des champs explicites; le reste dépend du fallback heuristique.
- Pas de test pour le path traversal via symlinks.
- `sanitizeUserAnswer` dans `output.ts` ne strippe pas les tags HTML (sauf backticks et `<instruction>`).

**Recommandations :**
1. Valider `QUORUM_COMMENT_FILE` avec `path.resolve` + vérification de racine.
2. Utiliser `fs.realpathSync` dans `assertPathInside` pour résoudre les symlinks.
3. Étendre le registry des sensitive fields à tous les providers.
4. Renforcer `sanitizeUserAnswer` pour stripper tout HTML/MD.

---

## 5. Tests — 7/10

**Points forts :**
- 23 fichiers de test, ~247 tests passants — couverture solide.
- Injection de dépendances via `CliDeps` permettant des tests sans I/O réel.
- Multiples tests de sécurité critiques (injection de commandes, isolation d'environnement, évasion de sandbox, fuite de secrets).
- Tests de parser robustes couvrant les pathologies de sortie LLM (JSON dans prose, markdown fences, champs snake_case, etc.).
- Tests de retry OpenRouter exhaustifs (429, 502, 503, 504, erreurs réseau, Retry-After).
- Test de pipeline avec vrais patterns async (concurrency, abort, budget).
- Aucun test ne dépend de services externes.

**Points faibles :**
- Pas de couverture de code mesurée (pas de pourcentage rapporté).
- Client Ollama : aucun test d'erreur/réseau.
- Pas de test pour le mode `--interactive`.
- Pas de test pour les crashs subprocess (SIGSEGV, sortie partielle).
- `subprocess.test.ts` : seulement 3 tests — ne couvre pas l'exécution réelle, le piping stdin, ou la propagation d'erreurs.
- `terminal.test.ts` : seulement 32 lignes, 2 tests — couverture minimale du renderer.
- Pas de tests de performance ou de stress (sets de findings volumineux).
- Pas de test de race condition pour l'écriture concurrente des rapports.
- Pas de test d'intégration de bout en bout (CLI → providers → consensus → rapport).

**Risques :**
- Les paths d'erreur des providers subprocess (crash, sortie malformée) sont sous-testés.
- L'absence de couverture mesurée rend les régressions invisibles.

**Recommandations :**
1. Ajouter `bun test --coverage` au CI et viser >80% de couverture.
2. Ajouter des tests d'erreur pour chaque provider (crash, timeout, sortie malformée).
3. Ajouter des tests d'intégration de bout en bout avec des fake providers.
4. Ajouter des tests de stress sur le consensus (100+ findings).

---

## 6. Documentation — 7.5/10

**Points forts :**
- README.md (427 lignes) complet : installation, commandes, CI, configuration, consensus, sécurité.
- `ARCHITECTURE.md` (525 lignes) documente la structure, les décisions, et les flux.
- 6 ADRs (Architecture Decision Records) dans `docs/adr/`.
- `quorum.yaml.example` (156 lignes) avec commentaires explicatifs.
- AGENTS.md pour les contributeurs AI.
- `action.yml` pour GitHub Actions avec documentation des inputs.

**Points faibles :**
- Pas de documentation API générée (pas de JSDoc/TSDoc systématique).
- Le README ne mentionne pas le mode interactif `--interactive`.
- Pas de changelog visible.
- ADRs pourraient être plus détaillés sur les trade-offs.
- Pas de guide de contribution formel (uniquement AGENTS.md).
- Le README n'explique pas comment ajouter un nouveau provider.

**Recommandations :**
1. Ajouter un guide "Adding a new provider" au README.
2. Documenter le mode interactif.
3. Ajouter un CHANGELOG.md.

---

## 7. DevOps — 5/10

**Points forts :**
- CI GitHub Actions fonctionnelle (typecheck + test sur push/PR).
- GitHub Action composite (`action.yml`) pour auto-review des PRs.
- `bun install --frozen-lockfile` en CI pour reproductibilité.
- `.env.example` documenté.
- `postinstall.ts` automatisé pour les skills.

**Points faibles :**
- **Pas de Dockerfile** — pas de conteneurisation.
- **Pas de Prettier/ESLint** — seul `tsc --noEmit` comme linter.
- **Pas de pipeline de release** — pas de publish npm, pas de build automatisé.
- **Pas de monitoring/logging structuré** — tout va sur stderr ou `console.error`.
- **Pas de cache CI** pour les dépendances.
- **Pas de test de couverture** dans le CI.
- **Pas de badge de statut** dans le README.
- **Pas de preview/nightly builds**.

**Risques :**
- L'absence de linting autre que TypeScript laisse passer les incohérences de style.
- Pas de release automatisé = risque d'erreur manuelle et de versioning instable.

**Recommandations :**
1. Ajouter ESLint avec config stricte + Prettier.
2. Ajouter une pipeline de release (semantic versioning, npm publish).
3. Ajouter `bun test --coverage` au CI avec seuil minimum.
4. Ajouter un Dockerfile pour les users qui veulent utiliser en conteneur.
5. Ajouter du logging structuré optionnel (JSON logs).

---

## 8. Maintenabilité — 7/10

**Points forts :**
- Architecture modulaire facilitant l'ajout de nouveaux providers (factory pattern via `createSubprocessProvider`).
- Types stricts et exhaustifs attrapant les erreurs à la compilation.
- Bus d'événements découplant les composants.
- Hiérarchie d'erreurs domain-spécifique avec contexte.
- Tests sans I/O via injection de dépendances.
- Régistre de providers et de consensus permettant l'extension sans modification.

**Points faibles :**
- Duplication entre `review.ts` et `plan-review.ts`.
- `reviewer.ts` à responsabilités multiples (312 lignes).
- Certains utilitaires réimplémentés localement (`deepEqual`, `globToRegex`, `severityRank` dupliqué).
- Pas de logging structuré — debug difficile en production.
- `parseReportSummary` fragile (regex sur Markdown).
- ~4 560 lignes de source — taille raisonnable mais certaines fonctions dépassent 100 lignes.

**Risques :**
- La duplication entre commandes va croître avec de nouvelles fonctionnalités.
- L'absence de logging structuré rend le debugging en production difficile.

**Recommandations :**
1. Extraire les helpers partagés entre commandes.
2. Ajouter du logging structuré optionnel.
3. Refactorer `reviewer.ts` en modules séparés.

---

## 9. Standards et bonnes pratiques — 7/10

**Points forts :**
- TypeScript strict avec options maximales (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- ESM modules avec `.ts` dans les imports.
- Kebab-case pour les filenames, snake_case pour les configs YAML.
- Zod pour la validation runtime des configs.
- Conventionnalités de commit documentées dans AGENTS.md.
- Bun comme runtime moderne et rapide.

**Points faibles :**
- **Pas d'ESLint** — seul `tsc --noEmit` comme vérification statique.
- **Pas de Prettier** — formatage manuel.
- Imports `.ts` dans les chemins relatifs (spécifique à Bun, pas standard Node).
- `deepEqual` réimplémenté au lieu d'utiliser une lib.
- `globToRegex` custom au lieu de `minimatch`/`picomatch`.
- Pas de conventional commits enforcement (pas de commitlint/husky).
- `extra_args: z.array(z.never())` pour certains providers — pattern inhabituel.

**Recommandations :**
1. Ajouter ESLint + Prettier avec pre-commit hooks.
2. Remplacer `globToRegex` par `picomatch`.
3. Remplacer `deepEqual` par une lib éprouvée ou `structuredClone` + tri.

---

## 10. Qualité globale — 7.5/10

**Points forts :**
- Projet cohérent avec une vision claire (consensus review multi-provider).
- Sécurité sérieuse et testée — unusual pour un outil CLI.
- Architecture extensible (providers, consensus, pipelines).
- 4 surfaces de distribution (CLI, skill, GitHub Action, library).
- Documentation architecturelle solide.
- Tests de sécurité exhaustifs pour les surfaces d'attaque principales.

**Points faibles :**
- Manque de tooling DevOps (linting, release, Docker, couverture).
- Certains patterns de code (duplication, casts unsafe, regex fragiles).
- Performance non optimisée pour les grands sets de findings.
- Client Ollama sans retry — asymétrie avec OpenRouter.

---

# Score Technique Global

| Critère              | Note  |
| -------------------- | ----- |
| Architecture         | 8/10  |
| Code                 | 7/10  |
| Performance          | 6/10  |
| Sécurité             | 8.5/10 |
| Tests                | 7/10  |
| Documentation        | 7.5/10 |
| DevOps               | 5/10  |
| Maintenabilité       | 7/10  |
| Standards            | 7/10  |
| Qualité globale      | 7.5/10 |

## Note finale : **70.5 / 100**

**Classement : Bon** (70-79)

---

# Top 10 des Problèmes les Plus Critiques

### 🔴 1. Client Ollama sans retry
- **Fichier** : `src/providers/ollama/client.ts`
- **Impact** : Une seule erreur réseau tue la review locale. Asymétrique avec OpenRouter qui a des retries complètes.
- **Difficulté** : Faible — porter la retry logic d'OpenRouter (`maxRetries`, `retryBaseMs`, `Retry-After` header).
- **Gain** : Fiabilité significative pour les users Ollama.

### 🔴 2. Duplication entre `review.ts` et `plan-review.ts`
- **Fichiers** : `src/cli/commands/review.ts`, `src/cli/commands/plan-review.ts`
- **Impact** : Divergence inévitable, bugs en double, maintenance coûteuse.
- **Difficulté** : Moyenne — extraire `executePipelineAndWriteReport` et autres helpers partagés.
- **Gain** : Maintenance simplifiée, moins de bugs.

### 🟠 3. Pas d'ESLint ni Prettier
- **Impact** : Incohérences de style invisibles, pas d'auto-formatting, code review gaspillée sur le style.
- **Difficulté** : Faible — config standard ESLint + Prettier + pre-commit hook.
- **Gain** : Consistance, fewer review cycles, auto-formatting.

### 🟠 4. Cast unsafe `undefined as unknown as FindingGroup`
- **Fichier** : `src/consensus/grouping-v2.ts`
- **Impact** : Bug runtime potentiel si la logique de groupement change.
- **Difficulté** : Faible — construction propre du `FindingGroup` au lieu du cast.
- **Gain** : Corrections de bugs silencieux.

### 🟠 5. `QUORUM_COMMENT_FILE` path traversal en CI
- **Fichier** : `src/ci/report-check.ts`
- **Impact** : Écriture potentielle hors du répertoire attendu si l'env CI est compromis.
- **Difficulté** : Faible — validation de path avec `path.resolve` + vérification de racine.
- **Gain** : Sécurité renforcée en CI.

### 🟠 6. `parseReportSummary` parse le Markdown avec des regex
- **Fichier** : `src/ui/tui/utils.ts`
- **Impact** : Cassera silencieusement si le format de rapport change.
- **Difficulté** : Moyenne — refactor pour lire les rapports JSON structurés.
- **Gain** : Robustesse du dashboard TUI.

### 🟡 7. Consensus O(n²) sans optimisation
- **Fichiers** : `src/consensus/grouping.ts`, `src/consensus/grouping-v2.ts`
- **Impact** : Lent sur les gros sets de findings (50+).
- **Difficulté** : Moyenne — index par `(file, line_start)` pour le groupement.
- **Gain** : Performance pour les grandes reviews.

### 🟡 8. `severityRank` dupliqué dans `contradictions.ts`
- **Fichier** : `src/consensus/contradictions.ts`
- **Impact** : Divergence silencieuse si les niveaux de sévérité changent.
- **Difficulté** : Très faible — importer `severityRank` depuis `core/finding.ts`.
- **Gain** : Source de vérité unique.

### 🟡 9. Pas de couverture de test mesurée dans le CI
- **Fichier** : `.github/workflows/ci.yml`
- **Impact** : Régressions de coverage invisibles.
- **Difficulté** : Faible — ajouter `bun test --coverage --threshold=80` au CI.
- **Gain** : Confiance dans la couverture.

### 🟢 10. `dashboard.ts` utilise `process.stdout` au lieu de `CliIo`
- **Fichier** : `src/cli/commands/dashboard.ts`
- **Impact** : Incohérence DI, testabilité réduite.
- **Difficulté** : Très faible — passer `io.stdout` au lieu de `process.stdout`.
- **Gain** : Consistence et testabilité du dashboard.

---

# Quick Wins

| #  | Action                                                           | Effort | Gain      |
| -- | ---------------------------------------------------------------- | ------ | --------- |
| 1  | Ajouter ESLint + Prettier + pre-commit hooks                     | 2h     | Très haut |
| 2  | Porter la retry logic d'OpenRouter vers Ollama (client.ts)       | 1h     | Haut      |
| 3  | Remplacer le cast unsafe dans `grouping-v2.ts`                   | 30min  | Moyen     |
| 4  | Importer `severityRank` dans `contradictions.ts`                 | 10min  | Faible    |
| 5  | Valider `QUORUM_COMMENT_FILE` dans `report-check.ts`             | 30min  | Haut      |
| 6  | Ajouter `bun test --coverage` au CI                              | 30min  | Moyen     |
| 7  | Remplacer `process.stdout` par `io.stdout` dans `dashboard.ts`   | 10min  | Faible    |
| 8  | Ajouter `fs.realpathSync` dans `assertPathInside`                | 20min  | Moyen     |

---

# Dette Technique

| Dimension                    | Évaluation              |
| ---------------------------- | ----------------------- |
| **Niveau de dette**          | Modéré                  |
| **Risque de maintenance**    | Faible à moyen          |
| **Facilité d'évolution**     | Bonne                   |
| **Facilité d'onboarding**    | Bonne                   |

**Détails :**
Le code est bien structuré globalement, mais des bouts de duplication (`review.ts` / `plan-review.ts`) et des patterns ad-hoc (`deepEqual`, `globToRegex`, regex Markdown) s'accumulent. L'architecture extensible (registries, DI) facilite l'ajout de features, mais la duplication entre commandes va croître avec le temps. L'onboarding est facilité par la documentation architecturelle et les types stricts, mais freiné par l'absence de JSDoc et de guide "adding a provider".

---

# Analyse Senior

## 1. Est-ce un projet maintenable à long terme ?

**Oui, avec réserves.** L'architecture est solide et extensible. Les types stricts et les patterns DI facilitent les modifications ciblées. Les registres de providers et consensus permettent d'ajouter des fonctionnalités sans toucher au code existant. Mais l'absence de linting automatisé, de pipeline de release, et la duplication entre commandes sont des charges qui vont s'accumuler et ralentir la maintenance à mesure que le projet grandit.

## 2. Serais-je à l'aise pour reprendre ce projet ?

**Oui.** La documentation architecturelle (ARCHITECTURE.md + 6 ADRs) et les types stricts rendent le code navigable et compréhensible. Les tests de sécurité sont exemplaires. L'architecture en couches avec des frontières claires permet de comprendre chaque module indépendamment. J'aurais aimé plus de JSDoc et un guide "adding a provider", mais la factory pattern et les registres sont suffisamment parlants pour un développeur TypeScript expérimenté.

## 3. Est-ce que ça respecte les standards modernes ?

**Partiellement.** TypeScript strict avec toutes les options au maximum — excellent. ESM natif, Zod pour la validation, Bun comme runtime — moderne. Mais :
- ❌ Pas d'ESLint/Prettier (standard minimal en 2026)
- ❌ Pas de pipeline de release automatisée
- ❌ Pas de couverture de test mesurée
- ❌ Pas de conventional commits enforcement
- ⚠️ Quelques patterns ad-hoc au lieu de librairies établies (`globToRegex`, `deepEqual`)

## 4. Quels seraient les 5 premiers chantiers à lancer ?

1. **ESLint + Prettier + pre-commit hooks** — fondation de qualité. 2h.
2. **Porter la retry logic d'OpenRouter vers Ollama** — fiabilité immédiate des reviews locales. 1h.
3. **Extraire les helpers partagés** entre `review.ts` et `plan-review.ts` — réduire la duplication avant qu'elle ne diverge. 4h.
4. **Ajouter la couverture de test au CI** avec seuil minimum (80%) — visibilité sur les régressions. 1h.
5. **Pipeline de release automatisée** — semantic versioning + npm publish + GitHub Release. 4h.

## 5. Si j'étais CTO, quelle note globale donnerais-je ?

**7/10.** Le projet a une architecture solide, une sécurité au-dessus de la moyenne pour un outil CLI (les tests de sécurité sont impressionnants), et une extensibilité bien pensée via les registres. L'investissement dans la robustesse de l'output parsing et les défenses contre l'injection témoigne d'une maturité rare.

Ce qui manque pour passer à 8+ :
- Le tooling DevOps fondamental (linting, release, Docker, coverage mesurée)
- La réduction de duplication avant qu'elle ne devienne un problème structurel
- Un soupçon de polish (JSDoc, guide contributeur, changelog)

C'est un projet *bon* qui peut devenir *très bon* avec quelques semaines de travail ciblé sur l'infrastructure et le tooling. La base architecturale et sécuritaire est excellente — c'est souvent le plus difficile à corriger après coup.

---

*Rapport généré le 13 juin 2026 — Audit statique du code source (pas d'exécution).*
