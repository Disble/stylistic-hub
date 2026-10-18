# Hub API v1

The HTTP contract the add-in's `HubAnalysisAdapter` is written against. The machine-readable contract is `GET /api/v1/openapi.json` (OpenAPI 3.1), generated from the same zod schemas that validate each request; this page explains how to use it.

## Access

- Base URL: `https://localhost:<port>/api/v1`, served by the hub on the port the add-in manifest names.
- Every route requires `Authorization: Bearer <token>`. The task pane reads the token from `<meta name="stylistic-hub-token">` in `taskpane.html`, which the hub fills in when it serves the add-in. There are no accounts and no `/auth` routes: one hub serves one Windows user.
- Requests must come from loopback with the host `localhost:<port>` or `127.0.0.1:<port>`; CORS is granted only to `https://localhost:<port>`.

## Analyzing a document

1. `GET /status` tells whether the hub can analyze: `analysis.ready` is false, with a `reason` to show the user, until a provider and a model are chosen in the hub.
2. `POST /documents/{documentId}/analyses` with `{ genre, chunks: [{ id, text }] }` starts an analysis and answers `202` with it. `documentId` is the UUID the add-in keeps in the Word document; `genre` is stored on the document. The hub splits each chunk into parts at paragraph ends when it is too long for one model call, so a chunk may be up to a whole document.
3. Poll `GET /analyses/{analysisId}` until `status` is no longer `running`:
   - `completed`: every chunk has its suggestions.
   - `partial`: some chunks failed; each failed chunk says why in `error`, with the provider's own message; the others have their suggestions.
   - `failed`: no chunk succeeded.
   - `canceled`: `POST /analyses/{analysisId}/cancel` was called.
4. Apply each chunk's `suggestions`. Each has an `id` of 16 hexadecimal characters that is unique for good; its `anchor`, `context` and `justification` are never blank, its `anchor` is always inside its `context`, and a `track-change` always has `suggestedText`. Suggestions that break these rules are dropped by the hub and counted in the chunk's `dropped`.

`profile` on the analysis says what became of the document's style profile, which the hub updates once per analysis from every chunk: `pending`, `updated`, `unchanged` or `failed`. A failed profile update does not affect the suggestions. `GET /documents/{documentId}` returns the genre and the profile as Markdown.

## Feedback

`POST /feedback` with `{ suggestionId, action: "accept" | "reject", comment? }` answers `202`. The hub learns from it in the background; `GET /feedback/{feedbackId}` says what became of it: `outcome` is `acknowledged` without a comment, otherwise `updated` or `ignored`, with the model's `summary`. If the hub cannot start learning from it, the `202` already carries `status: "failed"` with the `error`.

## Preferences

`GET /preferences` and `PUT /preferences` with `{ correctionInstructions }` read and save the user's standing correction instructions (at most `correctionInstructionsMaxLength` characters); `null` or blank text clears them.

## Modules

`GET /modules` answers `{ modules: [{ id, version }] }`: each module the hub serves at `/m/<id>/` and the `<Version>` of its `manifest.xml`, read when the server started. A task pane can compare it with its own version and offer a reload when a newer one is served.

## Errors

Every error is `application/problem+json` (RFC 9457): `{ type, title, status, detail, code }`. Branch on `code`; show `detail`.

| `code` | Status | When |
|---|---|---|
| `unauthorized` | 401 | The token is missing, empty or wrong, or the header is not `Bearer` |
| `validation_failed` | 400, 415 | The body or a path parameter does not match the contract, or the body is malformed JSON (400) or not JSON (415); `detail` names what is wrong. The analysis request and its chunks refuse fields the contract does not name |
| `not_found` | 404 | No such analysis, document, feedback or suggestion, or no such route |
| `no_model` | 409 | An analysis was requested before a model was chosen in the hub |
| `payload_too_large` | 413 | The body is over 10 MB |
| `internal_error` | 500 | The hub failed; `detail` carries the message |

A model provider's failure is not an HTTP error: the analysis is accepted, and the chunk that failed carries the provider's message in `error`.

## Restarts

Analyses and feedback live in the hub's database, not in memory: after a hub restart, an analysis in progress resumes and finishes, and one whose run cannot finish is reported as `failed` with the reason, never as `404`.
