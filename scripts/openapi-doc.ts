// Writes the API v1 OpenAPI document of a source tree to a file, without starting the server, so CI can diff
// the current contract against the last server release's (docs/development.md#api-contract-check).
// Usage: bun scripts/openapi-doc.ts <tree root> <out.json>
// The tree root is this repository or an extracted copy of an older `src/` placed inside it, so its imports
// resolve against this repository's node_modules.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The tree to describe and the file to write. */
const [root, out] = process.argv.slice(2)
if (!root || !out) throw new Error('Usage: bun scripts/openapi-doc.ts <tree root> <out.json>')

/** The route definitions of that tree; the services are never called to describe them. */
const { apiV1 } = await import(pathToFileURL(resolve(root, 'src/backend/adapters/http/api-v1.ts')).href)
/** The API, built with empty services: only its routes and schemas are read. */
const api = apiV1({ serverVersion: '0.0.0', analyses: {}, feedback: {}, documents: {}, preferences: {} })
/** The response of `GET /openapi.json`. */
const response = await api.request('/openapi.json')
if (!response.ok) throw new Error(`GET /openapi.json answered ${response.status}`)
writeFileSync(out, `${JSON.stringify(await response.json(), null, 2)}\n`)
