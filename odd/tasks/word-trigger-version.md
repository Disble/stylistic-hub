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
| T1 | S1-S3 (hub) | worker | pending | |
| T2 | S4-S5 (addon) | inline | pending | |

## Log

- **L1** (2026-11-24, user, verbatim): "actualmente el plugin está dando error en word" — capture: Word ADD-IN ERROR "This add-in is no longer available…" in the task pane.
- **L2** (evidence): registry `Wef\Developer` names `components\stylistic-word-addin\manifest.xml`; that manifest is `<Version>1.1.0.0` with 10 URLs on `https://localhost:41730`; Office cache `Wef\{352B…}\…\Manifests\5d0c…_1.1.0.0` names 41730 (no stale 3000 copy). Bundled trigger refers to `version="1.0.0.0"`.
- **L3** (experiment): a copy of the installed `Stylistic.docx` with `version="1.1.0.0"`, opened in the user's Word, loaded Stylistic (user confirmed "Carga Stylistic", second capture shows the task pane). Workaround applied: installed `resources/word/Stylistic.docx` replaced with that copy (backup kept in the session temp dir).
- **L4** (user, verbatim, on the second capture): "BORRA ESTO", striking the privacy note under "Analizar y sugerir".
