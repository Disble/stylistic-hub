# Health validation via pinned-leaf TLS transport (Electron-safe)

**Outcome:** a safe health-check transport is confirmed without touching the CA: keep the original
critical `DNS:localhost + IPv4/IPv6` name constraints exactly as minted, and validate the downloaded
server's health over `node:https` with `ca` set to the exact managed **leaf** PEM plus
`allowPartialTrustChain: true`, `rejectUnauthorized: true`, and the default identity check.
No `rejectUnauthorized: false`, no custom verifier, no new dependency, no CA edit.

## Quick path

1. `hubStatusRequest` gains a health-only leaf mode: `ca: <certsDir>/localhost.pem` (the leaf file
   `ensureCertificates` already writes beside `ca.pem`) with `allowPartialTrustChain: true`.
2. Probes keep `rejectUnauthorized: true` and the default `checkServerIdentity`; the hub still
   connects to `https://localhost:<port>/api/v1/status` with the hub token and `Host: localhost:<port>`.
3. Implementation verifies with the adversarial matrix below, wired through the real `hubStatusRequest`.

## Details

| Topic | Finding |
|---|---|
| Primary source | Node `tls.createSecureContext` docs: `allowPartialTrustChain <boolean>` — "Treat intermediate (non-self-signed) certificates in the trust CA certificate list as trusted" (added v22.9.0 / v20.18.0, https://nodejs.org/api/tls.html). The peer cert must still chain to something in `ca`; hostname and validity enforcement are unchanged. |
| What is pinned | Only the exact managed leaf certificate (`localhost.pem`, ECDSA P-256, SANs `DNS:localhost, IP:127.0.0.1, IP:::1` in the fixtures mirroring production). It is read per poll like `caFile` is today, so backend leaf renewals are picked up on the next attempt. |
| Authority model | Trust moves from "any cert this CA signs" to "exactly this leaf cert". A compromised CA key cannot mint an accepted endpoint: any other cert (even same-CA, same-SAN, attacker key) has no chain to the pinned anchor and fails closed (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in probes P2/P3). Expiry is still enforced on the pinned anchor (`CERT_HAS_EXPIRED`, P5). Hostname is still enforced by the default `checkServerIdentity` (Node-level code, identical in Electron). |
| What did NOT change | CA file, constraints, leaf SANs, Word/Schannel trust install, add-in `Host` allowlist, token auth, `waitUntilHealthy` polling. The transport is health-probe-only; all other trust paths are untouched. |
| Blocker avoided | DNS-only CA rewriting was conclusively disproven (challenge verdict: DNS-only accepts attacker-IP leaves under Electron). This candidate preserves the full IP constraints and localhost/127.0.0.1/::1 compatibility per the user selection. |

## Scratch evidence (isolated, ephemeral ports, scratch keys only)

CA minted with the production constraint shape (critical, permitted `DNS:localhost`,
`IP:127.0.0.1/255.255.255.255`, `IP:::1/128`); five same-CA leaves served by stock `node:https`
servers on 127.0.0.1: good (localhost SANs), evil-cn (same-CA, `DNS:localhost`, attacker key),
evil-ip (same-CA, `DNS:localhost + IP:203.0.113.10`), wrongname (`DNS:other.invalid`),
expired (good SANs, `notAfter == notBefore`).

System Node v24.21.0 / OpenSSL 3.5.8, options `{ ca: <pinned leaf>, allowPartialTrustChain: true,
rejectUnauthorized: true }`, all six exit 0, process exit 0:

- `P1 pin-good/serve-good → resolved 200 authorized=true authErr=null`
- `P1b same without flag → resolved 200 authorized=true` (exact-EE-match accepted under OpenSSL)
- `P2 serve-evil-cn → rejected unable to get local issuer certificate [UNABLE_TO_GET_ISSUER_CERT_LOCALLY]`
- `P3 serve-evil-ip → rejected unable to get local issuer certificate [same code]`
- `P4 serve-wrongname → rejected unable to get local issuer certificate [same code]`
- `P5 pin-expired/serve-expired → rejected certificate has expired [CERT_HAS_EXPIRED]`

Hub-runtime proof (scratch Electron main process, no window):
`ELECTRON_RT node=v24.21.0` then `response 200 authorized=true`, exit 0, with
`{ ca: <pinned good leaf>, allowPartialTrustChain: true, rejectUnauthorized: true }` against the
live good fixture. So BoringSSL honors the flag for the legitimate endpoint and runs the full
verification (`authorized=true`).

Limitation, stated plainly: three later Electron scratch probes with identical options hung and
were killed by timeout (treated as failure, not retried). Hang direction is fail-closed for a
health probe — `waitUntilHealthy` already converts slow/failed attempts into `false`, never into
false-trust — but implementation must re-prove reliability through the real `hubStatusRequest`
wiring before rollout. The adversarial rejections rest on anchor-chaining logic (no anchor, no
chain), which BoringSSL enforces at least as strictly as OpenSSL per the original diagnosis.

## Checklist

- [ ] Reviewer confirms no CA/certificates.ts change is needed for this candidate.
- [ ] Reviewer confirms `allowPartialTrustChain` + pinned leaf is not a verification bypass
      (rejectUnauthorized stays true; identity/expiry enforced per matrix).
- [ ] Implementation re-proves Electron reliability via `hubStatusRequest` (not scratch scripts).

## Next step

Parent routes implementation; minimal exact surfaces (no globs):
`src/main/health-request.ts` (leaf-pinning option), `src/main/hub-paths.ts` (expose
`certs/localhost.pem` beside `caCert`), `src/main/app.ts` wiring (Word-owned surface),
`src/main/health-request.test.ts` (new: pin-good/evil/expiry/name-mismatch matrix). No backend,
packaging, docs, or trust-store changes required.
