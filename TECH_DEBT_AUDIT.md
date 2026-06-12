# Audit Clean Code & Best Practices — Quorum

Generated: 2026-06-12

## Executive Summary

- Le socle est sain: TypeScript strict, schemas Zod, tests rapides, `bun run typecheck`, `bun test`, `bun test --coverage` et `bun audit` passent.
- Dette principale: orchestration CLI/runtime/provider où beaucoup de responsabilités se concentrent dans `cmdReview`, `PipelineExecutor`, `workspace` et parsing de sorties LLM.
- Résolu depuis cet audit: `semantic-v2` propage maintenant le `AbortSignal` pipeline aux meta-reviewers OpenRouter/subprocess.
- Risque sécurité CI: les annotations GitHub Actions ne sont pas échappées selon le format workflow command; un finding malicieux peut casser/forger des annotations.
- Dette de contrat: `ProviderConfigSchema.catchall(z.unknown())` décale la validation provider au runtime, sauf pour `metaReviewerProvider`, qui n'est pas validé avant usage.
- Dette maintenabilité: glob maison, parsing diff maison, extraction JSON permissive et normalisation silencieuse des findings augmentent la surface de bugs.
- Tests: couverture globale correcte (~90% lignes), mais gaps sur interactive QA, meta-review provider, chemins d'erreur subprocess/report et branches CLI.
- Dépendances: `@faker-js/faker` est une dépendance runtime uniquement pour générer des ids; coût/poids peu aligné avec une CLI légère.
- Tooling audit non disponible localement: `knip`, `madge`, `depcheck`; `bun audit` OK.

## Architectural Mental Model

Quorum est une CLI Bun/TypeScript. Le flux principal est: CLI parse flags -> config YAML validée/interpolée -> runtime enregistre providers/consensus -> workspace construit diff git -> reviewers exécutent providers HTTP/subprocess -> executor agrège résultats -> consensus -> rendu JSON/Markdown/terminal/CI. Les ADR décrivent correctement les couches: `core` sans I/O, `providers` pour transport, `runtime` pour registry/config/bus, `pipelines` pour orchestration, `ui` pour rapports.

Le code respecte globalement cette architecture, mais certains modules "colle" ont grandi autour de workflows complets: `src/cli/commands/review.ts`, `src/pipelines/executor.ts`, `src/runtime/workspace.ts`, `src/reviewers/output.ts`, `src/providers/subprocess.ts`. Ce sont les zones de dette à traiter progressivement.

## Findings Table

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|---|---|---:|---|---|---|---|
| F001 | Cancellation/Performance | `src/providers/openrouter/index.ts:169` | RESOLVED | M | Meta-review OpenRouter utilisait un nouvel `AbortController` jamais relié au signal du pipeline. | Corrigé: `MetaReviewFn` reçoit un contexte avec `AbortSignal`, propagé depuis `PipelineExecutor`. |
| F002 | Cancellation/Performance | `src/providers/subprocess.ts:309` | RESOLVED | M | Meta-review subprocess utilisait aussi un signal neuf non annulable par pipeline timeout. | Corrigé: `createSubprocessMetaReviewer` utilise le signal reçu dans le contexte meta-review. |
| F003 | Security | `src/ci/report-check.ts:56` | High | S | Les annotations GitHub Actions interpolent `file`, `title`, `body` sans échappement workflow command. | Encoder `%`, `\r`, `\n`, `:`, `,` selon GitHub workflow commands avant `::error`. |
| F004 | Security | `src/ci/report-check.ts:149` | Medium | S | Le corps des findings est injecté brut dans un bloc HTML `<details>`. Markdown/HTML d'un modèle peut dégrader ou injecter du contenu PR. | Échapper ou borner le Markdown des findings dans les commentaires CI, ou rendre en bloc quote/code. |
| F005 | Contract Debt | `src/config/schema.ts:21` | Medium | M | Provider config accepte tout via `catchall(z.unknown())`; les erreurs provider ne sortent qu'à l'instanciation. | Garder l'extensibilité, mais valider les providers connus dès le load config. |
| F006 | Contract Debt | `src/pipelines/executor.ts:204` | Medium | M | `metaReviewerProvider` est résolu sans `resolveLazy` ni validation schema provider. | Ajouter `ProviderRegistry.createMetaReviewer()` qui valide comme `instantiate()`. |
| F007 | Error Handling | `src/runtime/workspace.ts:81` | Medium | S | `runGit` retourne `null` sur tout code non-zero, sans stderr; impossible de distinguer repo absent, ref invalide, git cassé. | Retourner un résultat typé `{ok,out,err}` et remonter les erreurs non attendues. |
| F008 | Correctness | `src/runtime/workspace.ts:98` | Medium | M | Parsing diff maison ne gère pas complètement les noms quotés/espaces/tabs/renames complexes. | Utiliser `git diff --name-only -z` pour la liste de fichiers, diff brut seulement pour le contenu. |
| F009 | Correctness | `src/runtime/workspace.ts:110` | Medium | M | `git ls-files --others` est lu en sortie newline; noms de fichiers avec newline cassent le parsing. | Utiliser `-z` et parser par `\0`. |
| F010 | Correctness | `src/runtime/workspace.ts:223` | Medium | S | Glob maison limité; comportements edge cases différents des libs standard. | Remplacer par `picomatch`/`minimatch` ou documenter strictement le sous-ensemble supporté. |
| F011 | Maintainability | `src/cli/commands/review.ts:23` | Medium | M | `cmdReview` orchestre config, diff, runtime, filtering, rendering, interactive, budgets, reports. | Extraire un `prepareReviewRun()` pur + `renderReviewResult()`. |
| F012 | Maintainability | `src/pipelines/executor.ts:26` | Medium | M | `PipelineExecutor.run` mélange lifecycle events, cancellation, concurrency, budget, consensus, verdict summary. | Extraire `ReviewerScheduler`, `PipelineCancellation`, `ConsensusRunner`. |
| F013 | Test Debt | `src/interactive/qa.ts:12` | Medium | S | Module interactif couvert à 5.41% lignes; c'est un flux utilisateur avec parsing et TTY. | Ajouter tests `deduplicateQuestions`, `promptQuestions`, non-TTY, sanitize. |
| F014 | Test Debt | `src/cli/commands/review.ts:154` | Medium | S | Branche interactive `runInteractive` peu couverte par coverage. | Tester deux phases, absence de questions, réponses injectées, erreurs phase 1/2. |
| F015 | Error Handling | `src/pipelines/executor.ts:117` | Medium | S | Consensus est calculé même après timeout/abort, et une meta-review peut relancer I/O. | Si `controller.signal.aborted`, passer un signal annulé au consensus ou désactiver meta-review. |
| F016 | Correctness | `src/pipelines/executor.ts:167` | Medium | S | Plan verdict par défaut devient `approve` si aucune review ne fournit de verdict. | Retourner `revise` ou `undefined` quand `summaries.length === 0`. |
| F017 | Data Quality | `src/reviewers/output.ts:181` | Medium | S | Ligne absente ou invalide normalisée à `1`; les findings semblent précis alors qu'ils ne le sont pas. | Autoriser `lineRange` optionnel ou marquer `lineUnknown`; ne pas inventer `1`. |
| F018 | Data Quality | `src/reviewers/output.ts:218` | Medium | S | Sévérité inconnue normalisée en `medium`; peut augmenter/diminuer artificiellement le signal. | Conserver `unknown` en erreur parse ou catégorie `info` + warning. |
| F019 | Security/Prompt Injection | `src/consensus/meta-reviewer.ts:56` | Medium | M | Prompt meta-review insère les bodies de reviewers sans délimiteurs ni framing "untrusted". | Encadrer Finding A/B dans fences sûrs et ajouter consigne anti-instruction. |
| F020 | Maintainability | `src/consensus/grouping-v2.ts:44` | Low | S | `undefined as unknown as FindingGroup` contourne le type system. | Utiliser un tableau `merged: boolean[]` ou construire un nouveau tableau. |
| F021 | Dependency Hygiene | `package.json:12` | Low | S | `@faker-js/faker` en dependency runtime pour générer des noms de reviewer. | Remplacer par une petite liste locale de noms ou passer en devDependency si non nécessaire runtime. |
| F022 | Observability | `src/runtime/bus.ts:35` | Low | S | Listener errors vont directement sur `console.error`, non injecté/testable. | Injecter logger ou émettre un event `bus.listener_failed`. |
| F023 | API Surface | `src/index.ts:1` | Low | S | Exports larges de modules core + runtime créent une API publique difficile à stabiliser. | Définir une surface publique explicite et documentée avant publication package. |
| F024 | CLI UX | `src/cli/args.ts:3` | Low | S | Parser flags minimal: pas de `--flag value` si value commence par `--`, pas de aliases formels, erreurs silencieuses. | Ajouter tests edge cases ou utiliser un parser léger. |
| F025 | Test Tooling | `package.json:8` | Low | S | `lint` = `tsc --noEmit`; pas d'ESLint/format ni règles no-floating-promises/import cycles. | Ajouter ESLint ciblé ou garder `tsc` mais documenter que "lint" signifie typecheck. |

## Top 5 Detailed Problems

### 1. Meta-review non annulable

**Problème**: `semantic-v2` peut déclencher une meta-review après les reviews. OpenRouter et subprocess créent un `AbortController` neuf (`src/providers/openrouter/index.ts:169`, `src/providers/subprocess.ts:309`), donc le timeout pipeline ne l'annule pas.

**Impact**: 🟠 Élevé. Un pipeline supposé timeout peut rester bloqué/coûter plus longtemps.

**Proposition**: changer `MetaReviewFn` en `(prompt, ctx) => Promise<string>` avec `signal`, `bus`, `workspace`; propager `controller.signal`.

**Exemple**

Avant:

```ts
for await (const event of client.chatStream(req, new AbortController().signal)) {
  if (event.type === 'token') chunks.push(event.text);
}
```

Après:

```ts
for await (const event of client.chatStream(req, ctx.signal)) {
  if (event.type === 'token') chunks.push(event.text);
}
```

**Justification**: respecte l'inversion de contrôle du pipeline, évite les I/O orphelines, rend les tests de timeout fiables.

### 2. Annotations GitHub Actions non échappées

**Problème**: `emitAnnotations` écrit `::error file=${f.file},line=...,title=${title}::${body}` avec données venant du rapport (`src/ci/report-check.ts:56`).

**Impact**: 🟠 Élevé. Un finding contenant newline, `%`, `::`, virgules ou retours peut casser/forger des annotations.

**Proposition**: ajouter encodeur workflow command.

**Exemple**

Avant:

```ts
console.log(`::error file=${f.file},line=${f.lineRange.start},title=${title}::${body}`);
```

Après:

```ts
console.log(
  `::error file=${escProp(f.file)},line=${f.lineRange.start},title=${escProp(title)}::${escData(body)}`,
);
```

**Justification**: durcit une frontière CI exposée aux sorties LLM et aux diffs non fiables.

### 3. Provider config trop tardivement validée

**Problème**: `ProviderConfigSchema` accepte tous les champs (`src/config/schema.ts:21`). C'est utile pour plugins, mais les providers intégrés pourraient être validés dès `loadConfigFromString`.

**Impact**: 🟡 Moyen. Les erreurs sortent plus tard, parfois après setup runtime; `metaReviewerProvider` est encore moins validé (`src/pipelines/executor.ts:204`).

**Proposition**: conserver une base permissive pour providers inconnus, mais brancher les schemas des providers connus dans le loader/runtime.

**Exemple**

Avant:

```ts
export const ProviderConfigSchema = z.object({ type: NonEmpty }).catchall(z.unknown());
```

Après:

```ts
const BuiltinProviderConfigSchema = z.discriminatedUnion('type', [
  OpenRouterConfigSchema,
  ClaudeCodeConfigSchema,
]);
```

**Justification**: feedback plus tôt, moins de duplication de validation, meilleure sécurité de configuration.

### 4. Workspace git masque des erreurs

**Problème**: `runGit` retourne `null` pour tout échec (`src/runtime/workspace.ts:81`) et `gitDiff` transforme cela en "pas de diff" (`src/runtime/workspace.ts:49`).

**Impact**: 🟡 Moyen. Un ref invalide ou un problème git peut produire un "nothing to review" trompeur.

**Proposition**: distinguer `no base ref`, `empty diff`, `git failed`.

**Exemple**

Avant:

```ts
if (code !== 0) return null;
```

Après:

```ts
if (code !== 0) {
  return { ok: false, stderr };
}
return { ok: true, stdout: out.trim() };
```

**Justification**: meilleure observabilité, diagnostics CLI plus fiables, moins de faux négatifs.

### 5. Parsing LLM trop permissif et normalisation silencieuse

**Problème**: sortie non stricte récupérée par scanning JSON (`src/reviewers/output.ts:135`), puis lignes/sévérités invalides sont normalisées (`src/reviewers/output.ts:181`, `src/reviewers/output.ts:218`).

**Impact**: 🟡 Moyen. Des findings mal formés deviennent crédibles au lieu d'être retriés/rejetés.

**Proposition**: mode strict par défaut après le retry; warnings structurés pour champs réparés; ne pas inventer ligne 1.

**Exemple**

Avant:

```ts
const lineStart = toInt(item.lineStart ?? item.line_start) ?? 1;
```

Après:

```ts
const lineStart = toInt(item.lineStart ?? item.line_start);
if (lineStart === null) return null;
```

**Justification**: améliore qualité du signal et évite de fausses localisations dans les rapports/CI.

## Priorisation ROI

### 🔴 Priorité 1

- F015: compléter la politique d'arrêt après abort/timeout si de nouveaux travaux post-consensus sont ajoutés.
- F003/F004: échapper les sorties CI GitHub Actions et commentaires PR.
- F007: ne plus masquer les erreurs git critiques en "pas de diff".

### 🟠 Priorité 2

- F005/F006: valider les configs providers connus et meta-review.
- F011/F012: extraire orchestration CLI/executor en unités testables.
- F013/F014: couvrir interactive QA.
- F017/F018: rendre le parsing findings plus strict.

### 🟢 Priorité 3

- F020: supprimer le cast `undefined as unknown`.
- F021: remplacer Faker.
- F023/F024/F025: réduire surface API, clarifier parser/lint tooling.

## Score Global

| Critère | Score |
|----------|------:|
| Clean Code | 7/10 |
| Architecture | 7/10 |
| Performance | 7/10 |
| Sécurité | 7/10 |
| Tests | 8/10 |
| Maintenabilité | 7/10 |
| Bonnes pratiques TypeScript/Bun | 8/10 |

**Score global: 7.3/10**

Justification rapide: base stricte et testée, architecture cohérente, mais dette concentrée dans les workflows d'orchestration et frontières non fiables: Git, CI annotations, subprocess/HTTP provider output et meta-review.

## Top 10 Améliorations

| Priorité | Action | Impact | Effort |
|----------|---------|--------|---------|
| 1 | Propager `AbortSignal` à `MetaReviewFn` | Élevé | Moyen |
| 2 | Échapper annotations GitHub Actions | Élevé | Faible |
| 3 | Remonter erreurs git explicites | Élevé | Faible |
| 4 | Valider `metaReviewerProvider` via registry | Moyen | Moyen |
| 5 | Tester `interactive/qa.ts` et `runInteractive` | Moyen | Faible |
| 6 | Ne plus inventer `lineStart=1` | Moyen | Faible |
| 7 | Remplacer liste de fichiers par `git diff --name-only -z` | Moyen | Moyen |
| 8 | Extraire `prepareReviewRun` de `cmdReview` | Moyen | Moyen |
| 9 | Supprimer cast `undefined as unknown` dans grouping | Faible | Faible |
| 10 | Remplacer Faker pour ids reviewer | Faible | Faible |

## Plan d'Action

### Quick Wins (< 1 heure)

- [ ] Ajouter helpers `escapeWorkflowCommandProperty` / `escapeWorkflowCommandData`.
- [ ] Changer verdict summary: pas de `approve` si aucun verdict.
- [ ] Supprimer `undefined as unknown as FindingGroup`.
- [ ] Ajouter tests pour `rankForFailOn`, annotations, verdict sans verdict.

### Court Terme (< 1 jour)

- [ ] Refactor `runGit` en résultat typé avec stderr.
- [ ] Ajouter tests interactive QA.
- [ ] Durcir parsing findings: ligne obligatoire ou `lineUnknown`.
- [ ] Valider `metaReviewerProvider` avant exécution.

### Moyen Terme (< 1 semaine)

- [ ] Propager cancellation dans consensus/meta-review.
- [ ] Remplacer parsing fichiers diff par commandes git `-z`.
- [ ] Extraire orchestration CLI en fonctions pures testables.
- [ ] Ajouter tooling local `madge` ou équivalent pour cycles.

### Long Terme

- [ ] Stabiliser API publique `src/index.ts` avant version package.
- [ ] Définir politique stricte de sorties LLM: strict JSON, repair mode explicite, telemetry des repairs.
- [ ] Formaliser une stratégie de plugin providers qui garde validation forte pour built-ins et extensibilité pour externes.

## Things That Look Bad But Are Actually Fine

- `ProviderConfigSchema.catchall(z.unknown())` (`src/config/schema.ts:21`) semble trop permissif, mais il sert l'objectif plugins/providers hétérogènes. Le problème est l'absence d'un second niveau de validation précoce pour providers connus.
- Le prompt diff est encadré avec fence dynamique (`src/cli/commands/review.ts:232`) et tests d'injection existent. Ce n'est pas une simple concaténation dangereuse.
- L'env subprocess est allowlisté (`src/providers/subprocess.ts:142`) et les tokens provider explicites sont injectés au cas par cas. Ce choix réduit correctement la fuite de secrets ambiants.
- Les gros fichiers de tests (`tests/cli.test.ts`, `tests/consensus.test.ts`) ne sont pas un problème prioritaire: ils testent des workflows publics et restent rapides.
- Le glob maison (`src/runtime/workspace.ts:223`) est acceptable si le projet assume un sous-ensemble simple; il devient dette seulement si les utilisateurs attendent la sémantique minimatch complète.

## Open Questions

- `semantic-v2` est-il considéré expérimental ou recommandé en production? La sévérité de F001/F002 dépend de cette réponse.
- Les commentaires PR doivent-ils préserver le Markdown complet des findings, ou vaut-il mieux privilégier la sécurité/neutralisation?
- Les providers externes sont-ils une cible court terme? Si oui, éviter un discriminated union fermé dans le schema racine.
- Les line numbers absents doivent-ils rejeter un finding ou être affichés comme "file-level finding"?

## Verification

- `bun run typecheck`: pass.
- `bun test`: 255 pass, 0 fail.
- `bun test --coverage`: pass, global ~90.06% lignes.
- `bun audit`: no vulnerabilities found.
- `knip`, `madge`, `depcheck`: non installés localement, non exécutés.
