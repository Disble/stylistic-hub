import { join } from 'node:path'

/** Where the hub keeps its state, all under Electron's per-user `userData` folder. */
export interface HubPaths {
  /** Pi's agent directory: `auth.json`, `models.json` and settings. */
  piDir: string
  /** The single embedded SQLite database. */
  database: string
  /** Local CA and the localhost certificate used to serve the task pane. */
  certificates: string
  /** This install's hub token, the secret the task pane presents to the API. */
  token: string
  /** The CA certificate the backend writes, the one Windows is asked to trust. */
  caCert: string
}

/** Resolves every hub path from Electron's `userData` folder. */
export function hubPaths(userData: string): HubPaths {
  return {
    piDir: join(userData, 'pi'),
    database: join(userData, 'stylistic.db'),
    certificates: join(userData, 'certs'),
    token: join(userData, 'hub-token'),
    caCert: join(userData, 'certs', 'ca.pem')
  }
}
