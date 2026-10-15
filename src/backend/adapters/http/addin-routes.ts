import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

/** Where the built add-in is and the token its task pane must send. */
export interface AddinRoutesOptions {
  /** stylistic-addon's webpack output (`dist/`). */
  dir: string
  token: string
}

/**
 * Serves the built add-in at the origin its manifest names (`https://localhost:3000`). The task
 * pane receives the hub token in a meta tag: only loopback clients with our Host reach this page,
 * other sites cannot read it (no CORS) and a process of the same user could read the token file
 * anyway. Never cached, so a new token is picked up on the next load.
 */
export function addinRoutes({ dir, token }: AddinRoutesOptions): Hono {
  const routes = new Hono()

  routes.get('/taskpane.html', async (c) => {
    const html = await readFile(join(dir, 'taskpane.html'), 'utf8')
    // Without the token the task pane would fail every call, so a build without </head> is an error.
    if (!html.includes('</head>')) throw new Error('taskpane.html has no </head> to put the hub token before')
    c.header('Cache-Control', 'no-store')
    return c.html(html.replace('</head>', `<meta name="stylistic-hub-token" content="${token}"></head>`))
  })
  routes.use('/*', serveStatic({ root: dir }))

  return routes
}
