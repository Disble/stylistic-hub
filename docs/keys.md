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

All keys are ed25519. A key's id is the first 16 hex characters of the sha256 of its raw public key. `keys/keys.json` carries a `version` and an `expires` 13 months ahead; its detached signature (`keys/keys.json.sig`, base64) is the root key's signature over the list's canonical JSON (object keys sorted at every depth), as `scripts/keys/key-list.ts` computes it.

## The ceremony

`powershell -ExecutionPolicy Bypass -File scripts\keys\ceremony.ps1` asks for the root passphrase twice without echoing it, then `scripts/keys/ceremony.ts`:

1. generates the root, next-root, catalog and two component keys;
2. sets the three online private keys as GitHub secrets through `gh secret set`'s standard input (they never touch a file);
3. writes the two root private keys, encrypted (PKCS#8, AES-256-CBC), to the output folder;
4. writes `keys/keys.json`, its signature and the two root public keys, which are committed.

It refuses to run again when `keys/keys.json` or the root key already exists. `-DryRun` rehearses it without GitHub, writing everything to the output folder.

## Later

- **Yearly:** re-sign `keys/keys.json` with the root key (new `version`, new `expires`) before it expires; the hub warns 30 days ahead.
- **Online key lost or compromised:** generate a new key, set its secret, and publish a key list signed by the root key that lists the new key and drops the old one. No new hub is needed.
- **Root key:** rotating it ships in a hub release, using the next root key the hub already embeds.

The tooling for the yearly re-sign and rotation comes with the signed-releases milestone (roadmap M3).
