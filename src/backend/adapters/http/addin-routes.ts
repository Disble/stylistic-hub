import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

/** Where the built add-in is and the token its task pane must send. */
export interface AddinRoutesOptions {
  /** stylistic-addon's webpack output (`dist/`). */
  dir: string
  token: string
}

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
export function addinRoutes({ dir, token }: AddinRoutesOptions): Hono {
  const routes = new Hono()

  routes.get('/taskpane.html', async (c) => {
    const html = await readFile(join(dir, 'taskpane.html'), 'utf8')
    // Without the token the task pane would fail every call, so a build without </head> is an error.
    if (!html.includes('</head>')) throw new Error('taskpane.html has no </head> to put the hub token before')
    c.header('Cache-Control', 'no-store')
    const page = await versionAssets(html, dir)
    return c.html(page.replace('</head>', `<meta name="stylistic-hub-token" content="${token}"></head>`))
  })
  // serveStatic's onFound runs after the response is built, too late to add a header.
  routes.use('/*', async (c, next) => {
    await next()
    if (c.res.ok) c.res.headers.set('Cache-Control', 'no-cache')
  })
  routes.use('/*', serveStatic({ root: dir }))

  return routes
}
