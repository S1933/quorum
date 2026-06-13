# Plan d'action agrégé — Audits Quorum v0.1.0

**4 audits analysés :** deepseek-pro (81/100) · glm5-1 (70.5/100) · kimi2-7 (74.5/100) · minimax-m3 (77/100)
**Score moyen : ~75.8/100 — Bon**
**Synthèse :** Fondations solides (architecture 8.0, sécurité 8.3, doc 8.5), outillage DevOps en retard (6.0).

---

## Scores moyens par critère

| Critère | deepseek | glm | kimi2 | minimax | **Moy** |
|---|---|---|---|---|---|
| Architecture | 8 | 8 | 8 | 8 | **8.0** |
| Qualité code | 8 | 7 | 7.5 | 8 | **7.6** |
| Performance | 7 | 6 | 7 | 7 | **6.8** |
| Sécurité | 9 | 8.5 | 7.5 | 8 | **8.3** |
| Tests | 8 | 7 | 8 | 8 | **7.8** |
| Documentation | 9 | 7.5 | 8.5 | 9 | **8.5** |
| DevOps | 7 | 5 | 6 | 6 | **6.0** |
| Maintenabilité | 8 | 7 | 7.5 | 8 | **7.6** |
| Standards | 9 | 7 | 7 | 7 | **7.5** |
| Qualité globale | 8 | 7.5 | 7.5 | 8 | **7.8** |

---

## 🔴 Priorités critiques (cités par les 4 auditeurs)

| # | Action | Effort | Impact | Auditeurs |
|---|---|---|---|---|
| C1 | **Ajouter un linter/formateur** (Biome recommandé) + scripts `lint`/`format` | 2h | Qualité, cohérence, onboarding | deepseek, glm, kimi2, minimax |
| C2 | **Créer un Dockerfile** minimal `FROM oven/bun:1.3-alpine` | 45 min | Reproductibilité, déploiement | deepseek, glm, kimi2, minimax |
| C3 | **Automatiser les releases** (workflow + tags + CHANGELOG + npm publish) | 4h | Adoption, traçabilité | deepseek, glm, kimi2, minimax |

## 🟠 Priorités hautes (cités par 3+ auditeurs)

| # | Action | Effort | Impact | Auditeurs |
|---|---|---|---|---|
| H1 | **Corriger l'injection shell dans `action.yml`** — passer `--config` via `env:` | 10 min | Sécurité CI (critique) | kimi2, minimax |
| H2 | **Extraire les helpers partagés** entre `review.ts` et `plan-review.ts` | 4h | DRY, maintenabilité | deepseek, glm, minimax |
| H3 | **Supprimer les tests dupliqués** dans `tests/config.test.ts` (3 blocs) | 15 min | Lisibilité | deepseek, glm, kimi2, minimax |
| H4 | **Tester le TUI** — `parseReportSummary`, `extractPipelines`, `useInput` | 4h | Fiabilité (0% coverage → 80%) | deepseek, glm, kimi2, minimax |
| H5 | **Refactorer `runtime.ts`** — extraire `builtins.ts` + lazy loading | 4h | Évolutivité | deepseek, glm, kimi2, minimax |
| H6 | **Supprimer les `as XxxConfig`** (6 providers) — passer le type via Zod | 2h | Robustesse runtime | kimi2, minimax |
| H7 | **Ajouter un cache cross-run** — hash(diff) → `.quorum/cache/` | 6h | -50% coûts API | deepseek, glm, kimi2, minimax |

## 🟡 Priorités médium (cités par 2+ auditeurs)

| # | Action | Effort | Impact | Auditeurs |
|---|---|---|---|---|
| M1 | **Ajouter retry logic à Ollama** (porter depuis OpenRouter) | 1h | Fiabilité reviews locales | glm, minimax |
| M2 | **Remplacer le parsing regex fragile** dans `parseReportSummary` par frontmatter YAML | 3h | Robustesse dashboard | kimi2, glm, minimax |
| M3 | **`bunfig.toml` → `exact = true`** | 1 min | Builds déterministes | kimi2, minimax |
| M4 | **`bun-version` → `"1"`** dans CI et `action.yml` | 5 min | CI résilience | deepseek |
| M5 | **`verbatimModuleSyntax: true`** dans tsconfig | 1h | Cohérence type imports | deepseek, minimax |
| M6 | **Extraire `REDACTED_VALUE`** en constante | 5 min | Maintenance | deepseek, minimax |
| M7 | **Réutiliser `severityRank`** de `core/finding.ts` dans `contradictions.ts` | 10 min | Source unique de vérité | glm, minimax |
| M8 | **Supprimer `src/providers/continue-dev/`** (répertoire vide) | 1 min | Propreté | minimax |
| M9 | **Sanitization HTML dans les rapports** markdown | 30 min | Sécurité XSS | deepseek |
| M10 | **Tester le mode interactif Q&A** — `collectQuestions`, `deduplicateQuestions` | 3h | Fiabilité interactive | deepseek, kimi2, minimax |
| M11 | **Ollama streaming** (actuellement non-streaming) | 2h | UX, latence | deepseek |
| M12 | **Rate limiting proactif** (au-delà des retries OpenRouter) | 3h | Protection coûts | deepseek, kimi2 |
| M13 | **Ajouter couverture de test au CI** (`bun test --coverage --threshold=80`) | 30 min | Visibilité régressions | glm, deepseek |
| M14 | **Ajouter `fs.realpathSync`** dans `assertPathInside` pour symlinks | 20 min | Sécurité path traversal | glm |
| M15 | **Valider `QUORUM_COMMENT_FILE`** avec `path.resolve` | 30 min | Sécurité CI | glm |

## 🟢 Quick wins (< 30 min chacun)

| # | Action | Durée |
|---|---|---|
| Q1 | Fixer `action.yml` shell injection | 10 min |
| Q2 | `bunfig.toml` → `exact = true` | 1 min |
| Q3 | `bun-version` → `"1"` | 5 min |
| Q4 | Supprimer `continue-dev/` | 1 min |
| Q5 | Dédoublonner `config.test.ts` | 15 min |
| Q6 | Extraire `REDACTED_VALUE` | 5 min |
| Q7 | Réutiliser `severityRank` | 10 min |
| Q8 | Ajouter cache Bun dans `ci.yml` | 10 min |
| Q9 | Créer `CONTRIBUTING.md` | 20 min |
| Q10 | Créer `CHANGELOG.md` v0.1.0 | 15 min |
| Q11 | Ajouter timeout par question dans `qa.ts` | 20 min |
| Q12 | `github.actor !== 'dependabot[bot]'` skip CI | 5 min |

---

## Dette technique (consensus cross-audit)

| Métrique | Niveau | Commentaire |
|---|---|---|
| Dette globale | **Modérée** | Architecture saine, outillage en retard. |
| Risque maintenance | **Faible à moyen** | God-files + casts = friction, mais types stricts protègent. |
| Facilité d'évolution | **Bonne** | Registres + ADRs = ajouts bien encadrés. |
| Onboarding | **Bon** | README + ARCHITECTURE + ADRs + AGENTS.md. |
| Risque régression | **Moyen** | TUI non testé, casts silencieux. |

---

## Roadmap proposée

### Sprint 1 — Fondations DevOps (3 jours)
1. Q1-Q8 (quick wins immédiats)
2. C1 — Biome + pre-commit hooks
3. C2 — Dockerfile
4. C3 — Release workflow (semantic-release)

### Sprint 2 — Robustesse (5 jours)
1. H6 — Casts providers
2. H7 — Cache cross-run
3. H4 — Tests TUI
4. M10 — Tests Q&A
5. M13 — Couverture CI

### Sprint 3 — Refactoring (4 jours)
1. H5 — Runtime → builtins.ts + lazy loading
2. H2 — Helpers review.ts/plan-review.ts
3. M2 — Frontmatter YAML dans rapports
4. M9 — Sanitize HTML rapports

### Sprint 4 — Polish (2 jours)
1. M1 — Ollama retry
2. M11 — Ollama streaming
3. M5 — `verbatimModuleSyntax: true`
4. M14 — `realpathSync` dans `assertPathInside`
5. M15 — Valider `QUORUM_COMMENT_FILE`
6. Benchmarks consensus (100+ findings)
7. Smoketest E2E

**Score projeté après 4 sprints : 85-88/100 — Très bon**

---

## Vue par auditeur (références)

| Audit | Fichier | Score |
|---|---|---|
| deepseek-pro | `docs/audit-deepseek-pro.md` | 81/100 |
| glm5-1 | `docs/audit-glm5-1.md` | 70.5/100 |
| kimi2-7 | `docs/audit-kimi2-7.md` | 74.5/100 |
| minimax-m3 | `docs/audit-minimax-m3.md` | 77/100 |

---

*Généré le 13 juin 2026 — Agrégation des 4 audits techniques Quorum v0.1.0*
