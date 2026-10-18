# Health-check TLS: pinned managed leaf

The hub's own health probes trust exactly the managed `localhost.pem` leaf instead of the local CA.
Nothing else changes: the CA keeps its critical loopback name constraints, the leaf keeps its
`localhost`/`127.0.0.1`/`::1` identities, and Word, the task pane, and Windows trust keep using the CA.

## Quick path

1. `hubStatusRequest` takes an optional `leafFile` (`HubPaths.leafCert`, the `localhost.pem` the
   backend already writes beside `ca.pem`). Both app call sites — the server switch's health check
   and the module health probes — pass it.
2. With `leafFile`, the request sets `ca` to that file and `allowPartialTrustChain: true`, with
   `rejectUnauthorized: true` and the default hostname check. Without it, the request trusts the CA
   exactly as before.
3. The file is reread on every poll, so a backend leaf renewal takes effect on the next attempt.

## Details

| Topic | Decision |
|---|---|
| Why not the CA | The hub runtime (Electron's TLS stack) cannot verify the CA's IP name constraints, so every CA-anchored health poll fails while the server is listening. The pinned leaf terminates the chain before those constraints are evaluated. |
| Authority model | Trust narrows from "any certificate this CA signs" to "exactly this leaf". A leaked CA key cannot mint an accepted health endpoint: any other certificate has no chain to the pinned anchor and fails closed. Hostname and expiry are still enforced. |
| No silent fallback | A missing or unreadable `leafFile` rejects the attempt (`ENOENT`); the request never falls back to the CA. |
| Compatibility | Port, token, `Host` header, paths, timeouts, certificate generation, and all SAN/CA constraints are unchanged. The built-in server needs no health check and is untouched, as are schema and database logic. |
| Limits | Only the Electron main process's health probes use this mode. If the leaf and the running server ever disagree (for example mid-rotation), polls fail closed until they agree again. Findings that led here: `research_notes/electron-health-tls-transport.md`. |

## Checklist

- [ ] A downloaded server passes its health check and no longer rolls back with `health_check_failed`.
- [ ] The built-in fallback still starts without a health check.
- [ ] No CA, leaf-identity, token, or database behavior changed.

## Next step

Security verification of this transport follows through the parent's independent verifier; this
document does not replace it.
