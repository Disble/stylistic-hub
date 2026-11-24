# Word trigger follows the module version

After the add-in module moved from 1.0.0 to 1.1.0, Word showed "This add-in is no longer available" because the trigger document still referred to version 1.0.0.0.
Cross-project: hub (T1, this repo, branch `feature/word-trigger-version` from `dev`) and `stylistic-addon` (T2, branch `fix/remove-privacy-note` from `main`). T1 must ship before T2's release reaches users.

## Specs

- **S1** — "actualmente el plugin está dando error en word": with module `stylistic-word-addin` 1.1.0 installed and registered (stable manifest `<Version>1.1.0.0`), Word showed "ADD-IN ERROR — This add-in is no longer available: add-ins inserted during development are only available during debugging from Visual Studio…". The hub's trigger `resources/word/Stylistic.docx` refers to `<we:reference id="5d0c6b1e-7f2a-4c3e-9b8d-1a2f3e4c5d6e" version="1.0.0.0" store="developer" storeType="Registry" />` (`scripts/addin-document.ts` `TRIGGER_VERSION`, comment "Word loads the registered add-in by id" — disproven).
- **S2** — The document the Word session loader opens refers to the `<Version>` of the module manifest registered in Word, and follows it when the module version changes (install, update, rollback to `previous`), without reinstalling the hub. The add-in id stays the production id.
- **S3** — The bundled trigger keeps working as the template; a missing or unreadable manifest version leaves the loader with a usable document and one log line naming why.
- **S4** — "BORRA ESTO": the add-in task pane no longer shows "El texto que analizas y el perfil de estilo del documento solo se envían al proveedor que elegiste en Stylistic Hub. No se envía nada más a ningún lugar".
- **S5** — Workspace rule (neutral Spanish, no voseo): the same empty state says "Analiza el documento completo o selecciona un fragmento para empezar." instead of "Analizá … seleccioná …".

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1-S3 (hub) | inline (worker unavailable) | done | see L6 |
| T2 | S4-S5 (addon) | inline | done | stylistic-addon `fix/remove-privacy-note` c4a534b, see L5 |

## Log

- **L1** (2026-11-24, user, verbatim): "actualmente el plugin está dando error en word" — capture: Word ADD-IN ERROR "This add-in is no longer available…" in the task pane.
- **L2** (evidence): registry `Wef\Developer` names `components\stylistic-word-addin\manifest.xml`; that manifest is `<Version>1.1.0.0` with 10 URLs on `https://localhost:41730`; Office cache `Wef\{352B…}\…\Manifests\5d0c…_1.1.0.0` names 41730 (no stale 3000 copy). Bundled trigger refers to `version="1.0.0.0"`.
- **L3** (experiment): a copy of the installed `Stylistic.docx` with `version="1.1.0.0"`, opened in the user's Word, loaded Stylistic (user confirmed "Carga Stylistic", second capture shows the task pane). Workaround applied: installed `resources/word/Stylistic.docx` replaced with that copy (backup kept in the session temp dir).
- **L4** (user, verbatim, on the second capture): "BORRA ESTO", striking the privacy note under "Analizar y sugerir".
- **L5** (T2): `AnalyzeSection` no longer renders the privacy note (constant, style slot and test id removed); voseo fixed in `HeroEmptyState` ("Analiza … selecciona …") and `CorrectionInstructionsSection.constants.ts` ("quieres", "Vigila"), plus the two examples in `docs/frontend-user-preferences.md`. Test fixtures that simulate text the user typed ("Vigilá X.") are left as they are. RED 3 (AnalyzeSection, HeroEmptyState, constants), GREEN; full suite 557/557, hooks green.
- **L6** (T1): the gentle-ai-worker failed again with `unavailable` (same cause as the reviewer: Anthropic credentials), not relaunched; done inline. `src/main/word-trigger.ts` rewrites the bundled trigger's `<we:reference version>` to the registered manifest's `<Version>` with `adm-zip` (already used by `scripts/addin-document.ts`, bundled into main), staged and renamed. `module-switch.ts` writes `components/<id>/Stylistic.docx` after each stable manifest (option `wordTrigger`, export `wordTriggerOf`); on failure it removes the file and logs `cannot write its Word trigger, so Word is shown the bundled one`. `updates/install.ts` prune keeps `Stylistic.docx`. `word-session.ts` resolves `-Document` on each spawn; `app.ts` gives the module trigger when it exists, else the bundled one. The loader reads the add-in names from the manifest beside its document, so it now finds the module's names too. RED: 3 module-switch + 1 word-session; GREEN 164/164 in the touched suites; typecheck green. Open: user documents saved while the 1.0.0 pane was open may still refer to 1.0.0.0.
