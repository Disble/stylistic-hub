// What the hub trusts without asking the network: the root public keys, embedded at build time from
// keys/root.pub and keys/root-next.pub, and where the signed catalog lives (docs/signed-releases.md).
import rootPub from '../../../keys/root.pub?raw'
import rootNextPub from '../../../keys/root-next.pub?raw'

/** The release whose assets are `keys.json`, `catalog.json` and their signatures. */
export const CATALOG_URL = 'https://github.com/Disble/stylistic-hub/releases/download/catalog/'

/** The raw ed25519 public key in a `*.pub` file (`{ id, publicKey }`, base64). */
function rawKey(file: string): Buffer {
  return Buffer.from((JSON.parse(file) as { publicKey: string }).publicKey, 'base64')
}

/** The root key and the next root key, either of which may sign `keys.json`. */
export const ROOT_KEYS: readonly Buffer[] = [rawKey(rootPub), rawKey(rootNextPub)]
