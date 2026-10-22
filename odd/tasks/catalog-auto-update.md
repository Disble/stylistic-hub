# Cumulative beta channel and releases that feed the catalog

Objective: a hub, server or module on `beta` is never offered less than `stable`, and every release reaches the signed catalog without a hand-edited PR. Branch `feature/catalog-auto-update` from `dev`. Runner: vitest; local gate `bun run check`. Delivery: work-unit commits merged `--no-ff` into `dev`; pushing to `dev`/`main` and changing repository settings are the user's decisions.

## Specs

- **S1 Cumulative beta** (supersedes channels.md S1 "A beta channel accepts beta entries only"): the `beta` channel offers the newest version among the `beta` and `stable` entries of a component; `stable` offers `stable` entries only. Pulled versions and rollout apply as before. Approved by the user (L2): "Beta acumulativo: el canal Beta ofrece la versión más nueva entre beta y stable".
- **S2 Newest only**: for each component the engine, the hub's self-update and the Library card pick the newest offered version (semver with `-beta.N`, a release after its betas), whatever the catalog order; a version marked bad on this install is skipped. Switching back to `stable` still installs the older stable (channels.md S2); switching to `beta` never downgrades.
- **S3 Releases feed the catalog**: after `release-server` and `release-hub`, CI writes the released component's entry (id, kind, publisher, channel, version, sha256, size, artifactUrl, componentUrl from its signed `component.json` and release assets) into `catalog/catalog.source.json` on `main`, replacing the entry of the same id and channel and keeping its `rolloutPercent` and `blocked`, through a pull request. Approved by the user (L2): "Releases que alimentan el catálogo… Para beta, ese PR podría mergearse solo. Stable seguiría pasando por tu revisión".
- **S4 Beta merges itself**: a beta entry's PR is merged by the workflow and the Catalog workflow is dispatched; a stable entry's PR stays open for review. A release already in the catalog changes nothing (no PR).
- **S5 Docs**: docs/signed-releases.md and docs/architecture.md describe S1–S4.

**Out of scope:** the add-in repository's release (another team's repo; it would open the same PR against this catalog).

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2, S5 | inline | done | RED 7 failing (L4), GREEN `bun run check` 680 passed |
| T2 | S3, S4, S5 | inline | pending | |
| T3 | all | independent verifier (Risk item 5: release/CI) | pending | |
| T4 | S3, S4 | user: repo setting "Allow GitHub Actions to create and approve pull requests", merge to dev | pending | |

## Log

- **L1** (2026-10-21) User: "con los demás igual? Se supone que un sistema como el de hub debe tener un sistema de update robusto" (Library on Beta: Server, Stylistic Hub and stylistic-word-addin all "None offered").
- **L2** (2026-10-21) User: "dale, hazlo", approving the proposal: beta cumulative; CI opens the catalog PR after each release, auto-merge for beta only, stable keeps review.
- **L3** Evidence: catalog.source.json on main holds only `stable` entries; `offered()` requires `entry.channel === channel`; the engine installs every wanted entry in catalog order, so two offered versions of one component would both install and the last listed would win. The repository has `can_approve_pull_request_reviews: false` (GITHUB_TOKEN cannot open PRs) and `main` is unprotected; a merge made with GITHUB_TOKEN does not trigger `push` workflows, so the Catalog workflow must be dispatched.
- **L4** T1 RED: 7 new tests failed before the change (Library beta card `available` not the newest of beta and stable; engine installed both offered versions in catalog order and downgraded on a switch to beta; self-update `no_hub_entry` for a stable hub on beta, served the first listed beta, and downgraded on a switch to beta). The "marked bad" test passed before and after (still-holds). GREEN: `newestOffered` in channels.ts (and `isNewer` moved there from self-update.ts) used by the engine, the self-update and the Library; `bun run check` exit 0, 680 tests. The old self-update test "serves the beta after a switch to beta even when it is older than the running stable" now asserts the opposite, as S2 requires.
