// Where the hub serves the API and the add-ins (odd/tasks/hub-port.md). Fixed, because Word registers the
// manifest with these URLs; kept off the ports development servers default to (3000, 5173, 8080, …) and below
// Windows' ephemeral range (49152+), where Hyper-V and WSL reserve blocks.

/** Port the task pane and the API share; fixed by the add-in manifest. */
export const HUB_PORT = 41730

/** The origin Word loads every add-in from. */
export const HUB_ORIGIN = `https://localhost:${HUB_PORT}`

/** The origin the hub served from before 41730; modules published then still name it. */
const FORMER_HUB_ORIGIN = 'https://localhost:3000'

/** The former origin as a whole origin: not a longer port (`:30001`) or a host that starts with it. */
const FORMER_ORIGIN_URL = new RegExp(`${FORMER_HUB_ORIGIN.replaceAll('.', '\\.')}(?![\\w.:-])`, 'g')

/** Points every URL of the former hub origin in a manifest at the hub origin; others are left as they are. */
export function pointAtHub(manifest: string): string {
  return manifest.replace(FORMER_ORIGIN_URL, HUB_ORIGIN)
}
