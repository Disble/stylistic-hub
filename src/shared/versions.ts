// fallow-ignore-next-line boundary-violation -- the server's version manifest, data only; semantic-release bumps it
import serverManifest from '../backend/package.json'

/** Version of the Local server component, released on its own from `src/backend/` (S6). */
export const SERVER_VERSION: string = serverManifest.version

/** Port the task pane and the API share; fixed by the add-in manifest. */
export const HUB_PORT = 3000
