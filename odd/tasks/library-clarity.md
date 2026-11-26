# Library screen says what each component is and which versions it can install

The user could not tell which card and channel to change to try hub 1.4.0-beta.1 ("but which one it is? idk").
Hub only, branch `feature/library-clarity` from `dev`. Small fixes to the existing Library screen; no new channel model.

## Specs

- **S1** — "i wanna know what versions can i install": each component card shows, for every channel it can follow, the version this install would get on that channel (the same rules the update engine applies: channel, rollout, pulled and versions marked bad on this install), e.g. Stylistic Hub on Stable shows `Beta: 1.4.0-beta.1` beside the channel choice. A channel with nothing to offer says so instead of showing a version.
- **S2** — Accepted proposal (assistant, verbatim): "readable names with a one-line description on each card ("The app you're using now")". The Word module card no longer shows the raw catalog id `stylistic-word-addin`.
- **S3** — Accepted proposal (assistant, verbatim): "show the beta version next to the channel menu ("Beta: 1.4.0-beta.1")". Covered with S1.
- **S4** — Accepted proposal (assistant, verbatim): "add a **Restart to update** button when an update is waiting". It appears on the Stylistic Hub card only while a downloaded hub update waits for a restart, and restarting installs it.
- **S5** — Accepted proposal (assistant, verbatim): "rewrite the history in plain language". A line such as `2026-11-24 1.1.0 marked bad (health_check_failed)` reads as what happened to the user, without internal codes.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S3 | inline (worker unavailable, L4) | done | see L5 |
| T2 | S2 | inline | done | see L5 |
| T3 | S4 | none: already shipped (L4) | done | — |
| T4 | S5 | inline | done | see L5 |

## Log

- **L1** (2026-11-26, user, verbatim, with a Library screenshot: Server 1.1.0, Stylistic Hub 1.3.2 with its channel menu open on Stable/Beta, stylistic-word-addin 1.2.0): "but which one it is? idk"
- **L2** (user, verbatim): "but you know that this a problem of UX, right?"
- **L3** (user, verbatim, choosing the small fixes over a redesign of the channels): "first one, i wanna know what versions can i install"
- **L4** (evidence): the gentle-ai-worker failed with `unavailable` before editing anything, not relaunched; done inline. S4 already exists: the hub card shows "Restart and update to <version>" while `HubUpdateStatus` is `ready` (`LibraryScreen.tsx` `HubUpdate`, test "offers a restart only on a hub card with a downloaded update"); the user's screenshot had no downloaded update, so it did not show.
- **L5** (T1, T2, T4): `channels.ts` `newestInstallable` (the engine's rule: newest offered, minus versions marked bad on this install) now serves both `engine.ts` `wanted` and `library.ts`, which fills `LibraryComponent.offers` for stable and beta; `available` is the offer of the followed channel. Each card lists "Stable channel" and "Beta channel" with their versions ("None offered", "Not checked yet"), a plain name and description (Server, Stylistic Hub, Stylistic for Word), and history in plain words. RED 6 (2 library, 4 screen), GREEN 31/31 focused; engine, Home and Word suites green; typecheck and lint green.
- **L6** (review and verify of b034c3f): native review approved (lineage `review-2997649272c66583`, lenses reliability and readability) with advisories R3-A1 (an unknown history outcome would break the screen), R3-B1 (`available` now leaves out versions marked bad: intended by S1), R3-B2 (informational). Independent verify: engine refactor behavior-preserving (120/120 update tests); S2-S4 pass; S1 fail: offers ignored the engine's `replaces` guard (installed beta 1.2.0-beta.1 with the newest beta bad showed Beta 1.1.0, which the engine never installs); S5 fail: unmapped reasons (`crash_loop`, `bad_signature`, `sha256_mismatch`…) still showed as codes.
- **L7** (fixes): `replaces` moved from `engine.ts` to `channels.ts` and used by `library.ts`: a channel that would not replace the installed version shows the installed one. History maps every reason the engine, installer and server switch record; anything else shows as words; an unknown outcome falls back to words instead of throwing (R3-A1); `marked_bad` reads "The hub will not install X again: <why>". RED 2, GREEN 185/185 in library, updates, Home and Word suites; typecheck and lint green.
