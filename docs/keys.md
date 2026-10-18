# Signing keys

The keys that sign what the hub installs, as [ADR 0001](adr/0001-component-delivery.md) (D3) designs them. They were created once, by the ceremony below; nothing in this repository holds a private key.

## Keys and where they live

| Key | Signs | Private key | Public key |
|---|---|---|---|
| Root | `keys/keys.json` | Encrypted with a passphrase, kept offline by the maintainer (default folder `%USERPROFILE%\stylistic-root-keys`, backed up off the machine) | `keys/root.pub` |
| Next root | The key list after a root rotation | Same place, same passphrase | `keys/root-next.pub` (embedded one release ahead) |
| Catalog | `catalog.json` | GitHub secret `STYLISTIC_CATALOG_KEY` in `Disble/stylistic-hub` | Listed in `keys/keys.json` |
| Component (`stylistic-hub`) | `component.json` of the `hub` and `server` streams | GitHub secret `STYLISTIC_COMPONENT_KEY` in `Disble/stylistic-hub` | Listed in `keys/keys.json` with scope `stylistic-hub` |
| Component (`stylistic-addon`) | `component.json` of the add-in module stream | GitHub secret `STYLISTIC_COMPONENT_KEY` in `Disble/stylistic-addon` | Listed in `keys/keys.json` with scope `stylistic-addon` |

All keys are ed25519. A key's id is the first 16 hex characters of the sha256 of its raw public key. `keys/keys.json` carries a `version` and an `expires` 13 months ahead; its detached signature (`keys/keys.json.sig`, base64) is the root key's signature over the list's canonical JSON (object keys sorted at every depth), as `src/shared/signing/keys.ts` computes it (formats: [signed releases](signed-releases.md)).

## The ceremony

`powershell -ExecutionPolicy Bypass -File scripts\keys\ceremony.ps1` asks for the root passphrase (shown as typed in that window only and confirmed with y/n, so a typo is caught; an empty line generates one), logs each step without secrets to `%TEMP%stylistic-ceremony.log`, then `scripts/keys/ceremony.ts`:

1. generates the root, next-root, catalog and two component keys;
2. sets the three online private keys as GitHub secrets through `gh secret set`'s standard input (they never touch a file);
3. writes the two root private keys, encrypted (PKCS#8, AES-256-CBC), to the output folder;
4. writes `keys/keys.json`, its signature and the two root public keys, which are committed.

It refuses to run again when `keys/keys.json` or the root key already exists. `-DryRun` rehearses it without GitHub, writing everything to the output folder.

## Current keys

Created on 2026-10-18 (UTC): root `a49bd78323e2340c`, next root `d31edbcad900d12a`, catalog `77d3ce267f29ad27`, component `827aac48598c9373` (`stylistic-hub`), component `a1baaad201312a0f` (`stylistic-addon`). `keys/keys.json` is version 1 and expires on 2027-11-18; re-sign it by October 2027.

## Later

Key list changes run on the maintainer's machine with the root key: `powershell -ExecutionPolicy Bypass -File scripts\keys\update-key-list.ps1` asks for the root passphrase (typed as in the ceremony; a wrong one fails to decrypt the root key, so nothing is written), logs each step without secrets to `%TEMP%\stylistic-key-list.log`, then `scripts/keys/update-key-list.ts` changes `keys/keys.json`, raises its `version`, resets `expires` to 13 months ahead and signs it with the root key (`-Root <file>` when the root key is not in the default folder). Commit `keys/keys.json` and `keys/keys.json.sig` and merge them to `main`; the catalog job, which runs on every push to `main` touching `keys/**`, publishes them ([signed releases](signed-releases.md#workflows-and-urls)). No new hub is needed.

- **Rotation:** `-Rotate catalog`, `-Rotate stylistic-hub` or `-Rotate stylistic-addon` generates a new key for that target, sets its GitHub secret through `gh secret set` and adds its entry. The old entry stays: rotation is not revocation, and the `component.json` files the old key already signed keep verifying.
- **Revocation:** `-Revoke <keyId>` drops an entry. Whatever the dropped key signed is then rejected as `unknown_key`. After a rotation, revoke the old key once no current release depends on it; a lost or compromised key is rotated and then revoked at once.
- **Yearly:** re-sign `keys/keys.json` before it expires (the hub warns 30 days ahead) with `-Rotate catalog`, which also renews `expires`; revoke the old catalog key afterwards (the catalog is re-signed daily, so nothing depends on it after the next run).
- **Root key:** rotating it ships in a hub release, using the next root key the hub already embeds.
