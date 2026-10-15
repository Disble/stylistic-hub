# Removing user accounts and auth sessions: one Stylistic Hub per computer, bound to Pi

Scope note: as of 2026-10-15. Local evidence comes from read-only greps (no .env read). Web evidence is from primary sources where I could fetch them. Anything I could not fetch is marked UNVERIFIED.

Current-state evidence (local):
- Better Auth config: `stylistics-backend/src/auth/auth.ts:24` (`betterAuth({...})`), `:27` `trustedOrigins: getTrustedOrigins()`, `:36` `expiresIn: THIRTY_DAYS_IN_SECONDS`, `:53` `plugins: [bearer()]`.
- Auth tables: `stylistics-backend/src/auth/auth-schema.ts:13` (user.email unique), `:29` (session.token unique), `:38` and `:59` (`user_id` FKs on session/account).
- Office dialog bridge: `stylistics-backend/src/mastra/index.ts:219` (`/auth-complete`), `:255` (`/auth-bridge-session`), `:93-108` (`resolveDialogTargetOrigin` checks `parentOrigin` against trusted origins because the origin "will be allowed to exchange that code for a bearer session").
- Domain keyed by user: `stylistics-backend/src/infrastructure/persistence/schema/document.schemas.ts:18` (`user_id`), `:34` unique `(user_id, external_document_key)`; `.../user-preferences.schemas.ts:18,32` unique `user_id`; `.../repositories/user-preferences.repository.ts:23` `getUserPreferences(userId)`.
- Add-in: `stylistic-addon/src/infrastructure/config.ts:18` `MASTRA_BASE_URL = "http://localhost:4111"`, `:30` `AUTH_SESSION_STORAGE_KEY = "stylistic.auth.session.v1"`, `:42` `DOCUMENT_UUID_SETTINGS_KEY = "stylistic.document.uuid.v1"`; `stylistic-addon/src/adapters/auth/OfficeDialogAuthAdapter.ts:27` uses `displayDialogAsync`; `stylistic-addon/manifest.xml:18` AppDomain `https://localhost:3000`, `:24` SourceLocation `https://localhost:3000/taskpane.html`.

## 1. The three "sessions": which ones survive?

### Takeaway
Only two of the three are real needs. Better Auth app sessions can be removed completely. Pi agent sessions stay, as an internal persistence detail: in-memory for one-shot headless runs, JSONL when a conversation must be resumable. Workflow runs stay as domain records keyed by document, not by user.

### Cited Findings
- Better Auth sessions exist only to bind a browser or bearer token to a `user` row: 30-day expiry, bearer plugin, `session.token` unique, `session.user_id` FK — `stylistics-backend/src/auth/auth.ts:36,53`; `src/auth/auth-schema.ts:29,38` (local code).
- Pi's `SessionManager` supports three modes: `SessionManager.inMemory(cwd)`, `SessionManager.create(cwd, sessionDir)` (a new JSONL file), and `SessionManager.open(path, sessionDir, cwd)` (resume) — dhub `src/main/adapters/pi-session.ts:199-202` (local precedent). dhub also runs `SettingsManager.inMemory({})` for headless sessions at `pi-session.ts:266`.
- course-platform keeps resumable assistant conversations as JSONL. It uses `SessionManager.create(workspaceDir, sessionDir)` / `SessionManager.open(file, sessionDir)` at `server/assistant/session.ts:181-183`, and lists or finds them through `SessionManager.list` / `SessionManager.findById` in `server/assistant/history.ts:158,176,188` (local precedent).

### Inferences
- Use precise terms in code and docs. Drop "auth session" entirely. Call Pi's object an "agent conversation" (Pi `SessionManager`). Call a domain execution a "workflow run". Mixing the three is what makes "remove sessions" sound riskier than it is.
- Stylistic's style checks and rewrites look like one-shot headless runs, so `SessionManager.inMemory` fits them and leaves no JSONL to manage. If a chat or "explain this suggestion" thread must survive a Word restart, store its Pi JSONL under `userData/pi-agent/sessions/<document-uuid>/`. The document UUID is then the only link between a conversation and a document, with no user involved.
- Workflow runs need durable records (status, input hash, results) in SQLite, keyed by `document_id`. They do not need a Pi JSONL file unless they become conversational.

### Gaps
- I did not verify Pi SDK docs for whether `SessionManager.inMemory` still writes anything to disk (for example caches) in the current SDK version. Only the call sites were inspected.

## 2. Local API security without accounts

### Takeaway
An unauthenticated localhost HTTP API is reachable by any web page the user visits, and by DNS rebinding. Chromium's Local Network Access (LNA) now prompts for public-site to loopback requests, which helps, but it is not a sufficient control. Keep a per-installation secret token plus Host/Origin allowlisting. The token replaces Better Auth's bearer session, not the need for authentication.

### Cited Findings
- Chrome LNA covers requests from public sites to local or loopback destinations. Loopback is "any destination that resolves to the local machine," such as 127.0.0.0/8 and ::1. The permission prompt launched in Chrome 142. The ability to request the permission "is restricted to secure contexts" — [Chrome for Developers: Local Network Access](https://developer.chrome.com/blog/local-network-access).
- The first LNA milestone gates only public-to-local/loopback requests. Local-to-localhost requests are not gated yet, so a task pane on `https://localhost:3000` calling `http://localhost:4111` is not subject to the prompt. WebSockets, WebTransport and WebRTC were not gated at the Chrome 138 stage — [Chrome for Developers: Local Network Access](https://developer.chrome.com/blog/local-network-access).
- Chrome 146 reportedly split the permission into "Local Network" and "Loopback Network". The admin allowlist policy `LoopbackNetworkAllowedForUrls` exists — [Okta support](https://support.okta.com/help/s/article/configure-chrome-to-suppress-the-local-network-access-prompt-for-okta-fastpass?language=en_US) (secondary source).
- One secondary source says Chrome 156 (stable around 2026-10-20) removes the temporary enterprise opt-out, and that denial is sticky — [Supercharge Browser](https://www.superchargebrowser.com/library/chrome-156-local-network-access). UNVERIFIED against Google release notes.
- Edge: LNA restrictions are on by default from Edge 144, which deprecates the `LocalNetworkAccessRestrictionsEnabled` policy. Per-URL `LocalNetworkAccessAllowedForUrls` / `BlockedForUrls` exist from Edge 140. `LocalNetworkAccessRestrictionsTemporaryOptOut` is removed after Edge 146 — [Microsoft Edge policy: LocalNetworkAccessRestrictionsEnabled](https://learn.microsoft.com/en-my/deployEdge/microsoft-edge-policies/localnetworkaccessrestrictionsenabled). The Microsoft docs disagree on deprecation status between localized pages.
- Precedent DNS-rebinding guard: course-platform checks the socket peer is loopback (`isLoopbackAddress`, 127.0.0.0/8, ::1, ::ffff:127.x) and that the `Host` header hostname is in `{localhost, 127.0.0.1, [::1]}`. Its comment says: "A rebinding attack reaches the loopback socket under an attacker's hostname, so this refuses it even though the socket peer is local." The peer comes "only from the socket (`server.requestIP`), never from `X-Forwarded-For`" and the gate fails closed — `D:\Método PEN\course-platform\server\app.ts:~141-182` (local code; `isLoopbackAddress` ~143-149, `LOOPBACK_HOSTNAMES` ~151, `isLoopbackHost` ~153-167, `isAdminPeerAndHostAllowed` ~170-182).
- The existing backend already relies on an Origin allowlist for the bridge (`resolveDialogTargetOrigin`, `src/mastra/index.ts:93-108`).

### Inferences
Threats, from most to least likely:
1. **Drive-by web pages** (`fetch("http://localhost:4111/...")` from evil.com). LNA now prompts in Chromium browsers, but users click "Allow", Firefox and Safari differ, and simple CORS requests (form POST, `no-cors`) can still cause side effects without reading the response. Mitigations: require a non-simple header (`Authorization: Bearer <token>`), which forces a CORS preflight. Answer preflights only for an exact Origin allowlist (`https://localhost:3000`). Reject any state change without the token.
2. **DNS rebinding.** Check `Host` ∈ {`localhost:4111`, `127.0.0.1:4111`, `[::1]:4111`} on every request, as course-platform does. Bind only to 127.0.0.1, never 0.0.0.0.
3. **Other local processes and other Windows users on the same PC.** Loopback is shared by every session on the machine, so a Host/Origin check does nothing against a local process. Only a secret the process cannot read stops it. Store that secret in the per-user `%APPDATA%` userData, which the OS ACLs to that user. Same-user malware is out of scope, since it can read auth.json anyway.
4. **CSRF via the Office dialog bridge.** This disappears when `/auth-complete` and `/auth-bridge-session` are deleted, which removes attack surface.

How the task pane gets the per-install token (named pipes are not reachable from a webview):
- (a) **Hub-served bootstrap endpoint** `GET /hub/pairing`, answered only when Origin is exactly `https://localhost:3000`, Host is loopback, and the peer is loopback. This is simplest, but any local process can spoof Origin, so it protects only against browsers, not local processes. Acceptable if the threat model is "web pages", not "malicious local process".
- (b) **Hub serves the task pane itself** (static build at `https://localhost:3000` from the Electron main process or utilityProcess) and injects the token into the HTML at serve time, for example in a `<meta>` tag or an inline config. The token never transits a public API, and pages from other origins cannot read the HTML cross-origin. This is the recommended path, because the hub owns the `localhost:3000` origin anyway in production.
- (c) **Manifest query param** (`taskpane.html?t=...`). Rejected: the manifest is static, shared, and sideloaded, so it cannot carry a per-install secret, and URLs leak into logs.
- (d) **One-time pairing code** shown in the hub window and typed into the task pane, then cached in localStorage. This is robust against local processes, but adds UX friction. Keep it as a fallback if (b) is not possible.
- (e) **Office document settings / roaming settings.** Rejected: document settings travel inside the .docx, so a shared document would leak the token. RoamingSettings is an Outlook concept.
- Rotation: if the token is lost (localStorage cleared), the task pane re-fetches it through (b) on next load. No refresh-token lifecycle is needed.

### Gaps
- No primary Microsoft statement on whether Office's WebView2 host enables LNA for task panes, or whether Edge/Chrome enterprise policies apply to Office's WebView2. My inference is that it does not matter here because both origins are loopback, but this is not verified.
- I did not fetch OWASP's DNS-rebinding guidance. The course-platform code comment is the only cited rationale.
- Chrome 156 opt-out removal: secondary source only.

## 3. Office platform specifics

### Takeaway
Word on Windows hosts the task pane in Edge WebView2. localStorage there is not partitioned by Office (`partitionKey` is undefined) and lives in the WebView2 user data folder, which is per Windows user. Document `Settings` travel with the .docx, which suits the document UUID. `http://localhost:4111` from `https://localhost:3000` works today because loopback is a potentially trustworthy origin, so no backend TLS is strictly required. Word on the web, Mac, and iPad cannot reach a hub on another machine and are effectively out of scope.

### Cited Findings
- "Windows | any | Microsoft Edge (Chromium-based) with WebView2"; Mac and iOS use Safari WKWebView; Office on the web runs in "The browser in which Office is opened." — [Microsoft Learn: Browsers and webview controls used by Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/browsers-used-by-office-web-add-ins) (updated 2026-08).
- "The partition key is undefined in environments without partitioning, such as the webview controls for Office on Windows." Also: don't use cookies or localStorage to share state across Office applications; "Cross‑app persistence is not supported and is not guaranteed to work on any platform." — [Microsoft Learn: Persist add-in state and settings](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings).
- Document settings: the property bag "is available only to the instance of the content or task pane add-in that created it, and only from the document in which you save it", and requires `saveAsync` to persist — [same page](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings).
- Microsoft's own guidance for cross-document preferences is to use SSO and an online DB: "you could use SSO to obtain the user identity, and then save the user ID and their settings to an online database" — [same page](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings). With a local hub, the hub's SQLite plays that role for one machine.
- WebView2's user data folder holds localStorage data, and controls that share a user data folder share the session — [Microsoft Learn: Manage user data folders](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder) (from search summary; not fetched in full).
- Secure contexts: `http://localhost` is listed as "Secure (`localhost` URL)", and potentially trustworthy origins include hosts `localhost` and `127.0.0.0/8` / `::1/128` — [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
- LNA grants a mixed-content exemption only when the destination is known to be local (private IP literals, `.local`, or `targetAddressSpace`) — [Chrome LNA](https://developer.chrome.com/blog/local-network-access).
- Mixed-content blocking hits a task pane calling a non-loopback `http://` service (a user report) — [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/978587/outlook-add-in-javascript-based-using-react-js-vs).
- The existing add-in already calls `http://localhost:4111` from `https://localhost:3000` (`config.ts:18`, `manifest.xml:24`), which is empirical evidence that it works in WebView2 today.

### Inferences
- The task pane itself must stay HTTPS (`https://localhost:3000`), so the hub must ship a localhost certificate trusted by the Windows user store, which is what office-addin-dev-certs does in development. This is a real installer burden: cert generation plus trust prompt per Windows user. The API on `:4111` can stay plain HTTP on loopback. Serving both from one HTTPS origin (`https://localhost:3000/api/...`) would also remove CORS entirely and is simpler to secure (same-origin, no preflight allowlist). Recommended.
- localStorage is per Windows user (WebView2 user data folder lives under the user profile) and not per document. Fine for caching the hub token. The localStorage key `stylistic.auth.session.v1` becomes obsolete. Replace it with `stylistic.hub.token.v1`, and clear the old key on first run.
- Word on the web: the task pane runs in the user's browser, possibly on the same PC. `https://word.cloud.microsoft` (public) to loopback would trigger the LNA prompt, and Office on the web loads add-ins from the manifest URL inside an iframe. It may work on the same machine after the user grants permission, but it is fragile. Mark as unsupported. Mac/iPad: no Windows hub, so unsupported.

### Gaps
- No Microsoft doc found that names the exact WebView2 user data folder Office uses, or confirms that it is per Windows user (very likely under `%LOCALAPPDATA%\Microsoft\Office\...`; UNVERIFIED).
- Whether Office's WebView2 applies LNA prompts at all: no primary source found.

## 4. Several Windows users on one PC; one person with several PCs

### Takeaway
Make the hub per Windows user (Electron `userData` under `%APPDATA%`, single-instance lock per user), with dynamic or negotiated ports. A machine-wide service would recreate a multi-user server and need accounts again. Several PCs means separate, unsynced hubs. Offer export/import, and treat cloud sync as a future seam.

### Cited Findings
- dhub stores its DB and Pi agent dir in `app.getPath('userData')` (`src/main/app.ts:51,135,165`) and uses `app.requestSingleInstanceLock()` (`app.ts:173`). A code comment notes "its lock is per `userData`" (`src/main/capture-host.ts:17`) — local precedent.
- dhub writes `auth.json` "atomically (temp file, then rename) with owner-only permissions" (`src/main/adapters/pi-credentials.ts:46`). It reads the user's own `~/.pi/agent/auth.json` but never writes it (`pi-credentials.ts:18`; `agent-host.ts:32`) — local precedent.
- course-platform keeps Pi `settings.json`, `auth.json` and `models.json` in an app-owned directory, not the global Pi location (`server/ai-config.ts:16,38,66,286`). Secrets "live only in the app-owned `auth.json`" (`server/settings-store.ts:10`) — local precedent.

### Inferences
- Port conflicts: two Windows users signed in at once (fast user switching or RDP) share the loopback interface, so two hubs both binding 127.0.0.1:4111 collide. The second one fails, or worse, user B's task pane talks to user A's hub. Per-install tokens prevent B from using A's data, but B's add-in would then be broken. Options:
  - The task pane is served by the hub (§2b), so the hub can inject its actual port. The `:3000` port for the task pane origin is fixed by the manifest, though, so only one user's hub can own `https://localhost:3000`. This is a hard constraint of a static manifest. For a multi-user PC, either accept "one active hub per machine" (detect the conflict and show a clear error naming that another Windows user's hub is running), or ship per-user manifests with distinct ports (complex). Recommend: accept and detect. This is a rare case.
- A per-user hub keeps the Windows account as the real security principal. Windows ACLs on `%APPDATA%` protect the SQLite DB, auth.json, and the hub token.
- Several PCs: each hub has its own SQLite DB. Documents still carry their UUID inside the .docx, so a document opened on PC 2 is "new" there: no history, preferences start at defaults. Set the expectation explicitly in the UX, and provide "Export / Import hub data" (a zip of SQLite plus preferences, excluding auth.json) as the backup story.

### Gaps
- No measurement of how common multi-session Windows usage is among target users.

## 5. Data model: what replaces user_id

### Takeaway
Replace `user_id` with nothing at the domain level, or with a constant `owner_id` / `workspace_id` that defaults to the single local workspace. Keep the document UUID in .docx settings as the natural key (`document.external_document_key` unique by itself, or by `(workspace_id, external_document_key)`). User preferences become a singleton row per workspace.

### Cited Findings
- Current uniqueness: `unique(user_id, external_document_key)` (`document.schemas.ts:34`) and `unique(user_id)` on user_preferences (`user-preferences.schemas.ts:32`) — local code.
- The document UUID lives in `Office.context.document.settings` under `stylistic.document.uuid.v1` (`config.ts:42`), and document settings persist inside the document — [Microsoft Learn: Persist add-in state](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings).

### Inferences
- Recommended schema: add a `workspace` table with exactly one row created at first run (`id` = random UUID = installation id, `created_at`, `display_name`). Rename `user_id` to `workspace_id` with FK and default the single id. Keep `unique(workspace_id, external_document_key)`. This costs about one column, and re-adding accounts later becomes "a user belongs to workspaces" rather than a migration of every table.
- Copied documents: copying a .docx copies its UUID, so two files map to one record. This is true today too. Consider storing a content fingerprint, or detecting divergence and re-keying on conflict. Out of scope but worth noting.
- Migration from the hosted Postgres or Better Auth DB: there is no automatic path to a local hub. Provide an optional one-time "export my data" from the old backend (documents + preferences for the signed-in user), imported into the hub's single workspace. Drop the `user`, `session`, `account`, and `verification` tables. If no real users exist yet (pre-release), skip migration entirely. This needs confirming with the project owner.

### Gaps
- Whether production data exists in the current backend: not checked (no DB access, .env not read).

## 6. What is lost, and how to keep a seam

### Takeaway
You lose multi-device continuity, sharing or collaboration, server-side backup, and a hosted or SaaS offering with usage metering. A thin `Workspace` (owner) seam plus a pluggable `HubAuthPort` (local token now, accounts later) keeps re-adding accounts cheap.

### Cited Findings
- Microsoft's own pattern for cross-device user preferences relies on SSO and an online DB — [Microsoft Learn: Persist add-in state](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings).
- Both local Pi precedents (dhub, course-platform) have no app accounts. course-platform restricts admin to loopback peers ("One listener serves everyone, so administration exists only for a…", `server/app.ts:698`) — local code.

### Inferences
- Seam design (hexagonal):
  - `RequestPrincipal { workspaceId }` is resolved by an inbound adapter. Today `LocalHubTokenAuth` maps a valid hub token to the single workspace. Later, `BetterAuthAdapter` maps a session to user to workspace. Domain services take `workspaceId`, never `userId`.
  - Keep Better Auth out of the hub build (no dependency, no tables), but keep its port interface.
- Hosted future: Anthropic's terms (§7) already block subscription OAuth in third-party products, so a hosted Stylistic would need API-key billing anyway. That is a different product with real accounts. The seam above is enough; do not keep dormant auth code.

### Gaps
- No product decision available on whether a hosted offering is on the roadmap.

## 7. Pi provider logins (subscription OAuth): per-hub credentials, and terms

### Takeaway
Provider credentials in `auth.json` belong to the hub (the machine owner), not to app users. Removing app accounts does not change that. Anthropic explicitly forbids third-party apps from offering Claude.ai login or routing requests through Free/Pro/Max credentials, and from storing Claude.ai tokens. Stylistic must use Anthropic API keys only. For OpenAI ChatGPT/Codex subscription OAuth I found no primary policy; secondary sources say OpenAI tolerates or supports it.

### Cited Findings
- Anthropic: "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." Also: "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." — [Claude Code docs: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) (fetched 2026-10-15).
- Background: a February 2026 clarification and enforcement against third-party clients was reported — [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546). An Autonomee post (updated 2026-10-07) says the wording was rewritten since February — [Autonomee](https://autonomee.ai/blog/claude-code-terms-of-service-explained/). The fetched primary text above is current and still prohibits it.
- OpenAI: OpenCode shipped ChatGPT Plus/Pro (Codex) OAuth in January 2026, and OpenAI reportedly supported it publicly — [Dev Genius](https://blog.devgenius.io/jump-ship-in-minutes-codex-oauth-now-works-in-opencode-d2708c32f571); [Shareuhack](https://www.shareuhack.com/en/posts/opencode-anthropic-legal-controversy-2026). Secondary sources only; UNVERIFIED against OpenAI terms.
- Precedent handling: dhub persists sign-ins through the Pi SDK into its own `auth.json` (`src/main/adapters/pi-login.ts:35`; `pi-runtime.ts:10`) — local code.

### Inferences
- In the hub, disable or hide Pi's Anthropic subscription OAuth login provider. Allow an Anthropic API key, an OpenAI API key, and (with a disclaimer, pending a primary-source check) ChatGPT/Codex OAuth.
- Under Anthropic's wording, "on behalf of their users" is the key phrase. Even with no app accounts, a distributed app that lets an end user log in with their Claude subscription is "offer[ing] Claude.ai login into their own applications". Removing accounts does not create an exemption.
- auth.json: keep it app-owned in userData, written atomically with owner-only ACLs (dhub precedent). Never import the user's global `~/.pi/agent/auth.json` silently; dhub reads it only, as an explicit opt-in.

### Gaps
- OpenAI's primary terms for using ChatGPT-plan OAuth in third-party clients: not found.
- Google (Gemini CLI / Antigravity OAuth) terms: not researched.

## 8. Precedents: dhub and course-platform

### Takeaway
Both local Pi apps run without app accounts and own their Pi credentials in an app directory. course-platform shows the loopback peer + Host guard to copy. dhub shows the Electron userData layout, single-instance lock, and in-memory vs. JSONL Pi sessions. Neither has to serve a third-party webview (Word) over HTTP, which is Stylistic's unique extra risk: Stylistic still needs the token.

### Cited Findings
- course-platform `server/app.ts` (~141-182): `isLoopbackAddress` (127/8, ::1, IPv4-mapped), `LOOPBACK_HOSTNAMES = {localhost, 127.0.0.1, [::1]}`, `isLoopbackHost` (anti-rebinding Host check), `isAdminPeerAndHostAllowed` (socket peer only, fails closed) — local code.
- course-platform app-owned Pi runtime dir: `server/ai-config.ts:16-66,286`; `server/settings-store.ts:10,208` (migrates a legacy `auth.json`) — local code.
- dhub: SQLite and Pi dir in userData (`src/main/app.ts:51`), single-instance lock (`app.ts:173`), sessions `inMemory`/`create`/`open` (`src/main/adapters/pi-session.ts:199-202`), atomic owner-only auth.json (`pi-credentials.ts:46,69`) — local code.
- dhub's only `listen(...127.0.0.1)` hit is a test fixture (`src/main/adapters/mcp-fixtures.ts:140`) — local code.

### Inferences
- dhub appears to expose no production HTTP API; its renderer likely talks over Electron IPC. That is inferred from the grep, not verified. Stylistic cannot use IPC because Word's WebView2 is a foreign process, so it needs the course-platform guards plus a bearer token.

### Gaps
- I did not read dhub's renderer/preload in full to confirm the IPC-only claim.

---

### Recommended design (synthesis for the report writer)
1. Delete Better Auth (user/session/account/verification tables, `/api/auth/*`, `/auth-complete`, `/auth-bridge-session`, OfficeDialogAuthAdapter, localStorage `stylistic.auth.session.v1`).
2. Identity = one `workspace` row (installation id) per Windows user's hub. Domain FKs use `workspace_id`. Document key = `stylistic.document.uuid.v1` from .docx settings.
3. Transport: the hub (utilityProcess) serves the task pane and the API from one origin, `https://localhost:3000` (with a trusted localhost cert), bound to 127.0.0.1. This removes CORS and the mixed-content question.
4. Guards on every request: socket peer loopback, Host in the loopback allowlist (anti-rebinding), Origin exact-match for state-changing calls, and `Authorization: Bearer <hub token>`. The token is a 256-bit random value from userData, injected into the served task pane HTML. Constant-time compare, with rotation on demand.
5. Pi: headless runs use `SessionManager.inMemory`. Resumable chats use JSONL in `userData/pi-agent/sessions/<document-uuid>`. Workflow runs live in SQLite keyed by document.
6. Credentials: app-owned `auth.json` in userData, owner-only. No Anthropic subscription OAuth (API key only), per Anthropic's terms. OpenAI OAuth pending primary-source confirmation.
7. Multi-user PC: detect port 3000/4111 already owned by another hub and show a clear error. Multi-PC: export/import, no sync.
8. Seam: a `RequestPrincipal { workspaceId }` port, so accounts can come back as a different adapter.
