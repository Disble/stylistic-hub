import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

/** Where the built add-in is and the token its task pane must send. */
export interface AddinRoutesOptions {
  /** stylistic-addon's webpack output (`dist/`). */
  dir: string
  token: string
  /** The path these routes are mounted under (`/m/<id>` for a module); the root when absent. */
  mount?: string
}

/**
 * Reloads a task pane that Word opened without its host bridge (`window.external.GetContext`),
 * at most twice per pane. When a pane is the first one in a WebView2 that has just started, Word
 * sometimes never injects the bridge into that page: Office.js logs "There is no window.external",
 * Office never becomes ready and the pane stays blank, while a reload gets the bridge. Measured
 * 2026-10-21: blank in 5 of 5 cold starts without it, loaded in 3 of 3 with it. The key is cleared
 * once a load has the bridge; outside Word (no `_host_Info`) it does nothing.
 */
export const HOST_BRIDGE_GUARD =
  '(function(){var k="stylistic.hostBridgeReloads";' +
  'function bridged(){return !!window.external&&typeof window.external.GetContext!=="undefined"}' +
  'try{if(!/[?&]_host_Info=/.test(location.search)||bridged()){sessionStorage.removeItem(k);return}' +
  'var reloads=Number(sessionStorage.getItem(k))||0;if(reloads>=2)return;' +
  'setTimeout(function(){if(bridged())return;sessionStorage.setItem(k,String(reloads+1));location.reload()},1000)' +
  '}catch(e){}})()'

/** A `src` or `href` naming one of the build's own files: not another origin, no query yet. */
const LOCAL_ASSET = /\b(src|href)="(?![a-z]+:|\/\/)([^"?#]+)"/gi

/**
 * Adds each of the build's own files' modification time to its URL. Webpack names them the same in
 * every build and Word's WebView keeps them, so without this a new build would run old scripts.
 */
async function versionAssets(html: string, dir: string): Promise<string> {
  const versions = new Map<string, string>()
  for (const [, , path] of html.matchAll(LOCAL_ASSET)) {
    if (!path || versions.has(path)) continue
    const file = await stat(join(dir, path)).catch(() => undefined)
    if (file) versions.set(path, Math.trunc(file.mtimeMs).toString(36))
  }
  return html.replace(LOCAL_ASSET, (tag, attribute: string, path: string) => {
    const version = versions.get(path)
    return version ? `${attribute}="${path}?v=${version}"` : tag
  })
}

/**
 * Serves the built add-in at the origin its manifest names (`https://localhost:3000`). The task
 * pane receives the hub token in a meta tag: only loopback clients with our Host reach this page,
 * other sites cannot read it (no CORS) and a process of the same user could read the token file
 * anyway. The page is never cached, so a new token is picked up on the next load, and it names
 * this build's files, which Word must check again before reusing.
 */
export function addinRoutes({ dir, token, mount = '' }: AddinRoutesOptions): Hono {
  const routes = new Hono()

  routes.get('/taskpane.html', async (c) => {
    const html = await readFile(join(dir, 'taskpane.html'), 'utf8')
    // Without the token the task pane would fail every call, so a build without </head> is an error.
    if (!html.includes('</head>')) throw new Error('taskpane.html has no </head> to put the hub token before')
    c.header('Cache-Control', 'no-store')
    const page = (await versionAssets(html, dir)).replace(
      /<head(\s[^>]*)?>/i,
      (head) => `${head}<script>${HOST_BRIDGE_GUARD}</script>`
    )
    return c.html(page.replace('</head>', `<meta name="stylistic-hub-token" content="${token}"></head>`))
  })
  // serveStatic's onFound runs after the response is built, too late to add a header.
  routes.use('/*', async (c, next) => {
    await next()
    if (c.res.ok) c.res.headers.set('Cache-Control', 'no-cache')
  })
  // serveStatic reads the whole request path, mount included.
  routes.use('/*', serveStatic({ root: dir, rewriteRequestPath: (path) => path.slice(mount.length) }))

  return routes
}
