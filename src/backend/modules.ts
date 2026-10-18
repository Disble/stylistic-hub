import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { API_SCOPES, type ApiScope } from './adapters/http/module-tokens'

/** A module the backend serves at `/m/<id>/`, the version its manifest names and the API scopes it declared. */
export interface ServedModule {
  id: string
  dir: string
  version: string
  scopes: ApiScope[]
}

/**
 * `STYLISTIC_MODULES`: `{ "<id>": { "dir": "<absolute dir>", "scopes": ["<scope>", ...] } }`. Ids follow
 * the component id pattern of the signed documents (`src/shared/signing/documents.ts`), which also keeps
 * them safe in a URL path; scopes are the API route groups the module's `component.json` declares in
 * `requires.scopes`.
 */
const modulesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, 'a component id'),
  z.object({
    dir: z.string().refine(isAbsolute, 'an absolute directory'),
    scopes: z.array(z.string())
  })
)

/** Whether `scope` is an API route group the backend knows. */
const knownScope = (scope: string): scope is ApiScope => (API_SCOPES as readonly string[]).includes(scope)

/** The `<Version>` of an Office manifest; the add-in contract requires one. */
const MANIFEST_VERSION = /<Version>\s*([^<\s]+)\s*<\/Version>/

/**
 * The modules named by `STYLISTIC_MODULES`, each with the version its `manifest.xml` names, read once
 * at startup. The variable rather than a flag: older servers parse their flags strictly and would exit
 * on a new one, while they ignore a variable they do not know. Throws a message fit for the log when the
 * value itself is wrong (the hub's mistake); an unknown scope or a module without a manifest `<Version>`
 * (a module's mistake) is left out with a `log` line, so one module cannot stop the server.
 */
export function loadModules(
  value: string | undefined,
  log: (message: string) => void = (message) => console.error(`backend: ${message}`)
): ServedModule[] {
  if (value === undefined) return []
  let json: unknown
  try {
    json = JSON.parse(value)
  } catch (error) {
    throw new Error(`STYLISTIC_MODULES is not JSON: ${(error as Error).message}`, { cause: error })
  }
  const parsed = modulesSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `STYLISTIC_MODULES must be { "<id>": { "dir": "<absolute dir>", "scopes": [...] } }: ${z.prettifyError(parsed.error)}`
    )
  }
  return Object.entries(parsed.data).flatMap(([id, { dir, scopes }]) => {
    const manifest = join(dir, 'manifest.xml')
    let xml = ''
    try {
      xml = readFileSync(manifest, 'utf8')
    } catch {
      // A missing manifest is reported as a missing version below.
    }
    const version = MANIFEST_VERSION.exec(xml)?.[1]
    if (!version) {
      log(`STYLISTIC_MODULES: module ${id} has no <Version> in ${manifest}, so it is not served`)
      return []
    }
    for (const scope of scopes.filter((scope) => !knownScope(scope))) {
      log(`STYLISTIC_MODULES: module ${id} declares an unknown scope ${scope}, so its token does not get it`)
    }
    return [{ id, dir, version, scopes: scopes.filter(knownScope) }]
  })
}
