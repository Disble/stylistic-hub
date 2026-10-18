// Wiring of the hub's self-update to electron-updater (S4). Pointed at our loopback feed with the generic provider,
// it reads latest.yml, downloads the installer and re-checks its sha512 (NsisUpdater.js:33-52 and
// builder-util-runtime httpExecutor.js:468-470 in 6.8.10), and installs it when the hub quits. Our own
// app-update.yml supplies the cache folder it reads (AppUpdater.js:545) and no `publisherName`, so it attempts no
// Authenticode check (NsisUpdater.js:84-99): the hub is unsigned (ADR D10). electron-updater stays inactive in an
// unpackaged run (AppUpdater.js:254, 277-278). Usage from app.ts:
//   const selfUpdate = startSelfUpdate({ userData, currentVersion: app.getVersion() })
//   startUpdateChecks({ userData, fetch, onReport: selfUpdate.onReport })   // and selfUpdate.stop() on quit
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
// electron-updater is CommonJS: Node's ESM loader exposes only its default export (a named import fails at load).
import electronUpdater from 'electron-updater'
import type { CheckReport, UpdateEngine } from './engine'
import { HUB_ID } from './install'
import { createSelfUpdate } from './self-update'

/** electron-updater's singleton for this platform (NsisUpdater on Windows). */
const { autoUpdater } = electronUpdater

/** Starts the self-update of a hub running `currentVersion`; returns the report handler and a stop function. */
export function startSelfUpdate({
  userData,
  currentVersion,
  log = console.error
}: {
  userData: string
  currentVersion: string
  log?: (message: string) => void
}): { onReport: (report: CheckReport, engine: UpdateEngine) => Promise<void>; stop: () => void } {
  const configFile = join(userData, 'components', HUB_ID, 'app-update.yml')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  // Our feed serves no blockmap and no web-installer package: the full, verified installer only.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.disableWebInstaller = true
  // electron-updater emits `error` (AppUpdater.js:476-477); an EventEmitter with no listener would throw it.
  autoUpdater.on('error', (error: Error) => log(`self-update: electron-updater: ${error.message}`))
  const selfUpdate = createSelfUpdate({
    currentVersion,
    updater: {
      async check(url, { allowDowngrade }) {
        await mkdir(dirname(configFile), { recursive: true })
        const config = { provider: 'generic', url, updaterCacheDirName: `${HUB_ID}-updater` }
        await writeFile(configFile, JSON.stringify(config))
        autoUpdater.updateConfigPath = configFile
        autoUpdater.setFeedURL({ provider: 'generic', url })
        // electron-updater installs an older version only when allowed: after a channel switch (channels.md S2).
        autoUpdater.allowDowngrade = allowDowngrade
        const result = await autoUpdater.checkForUpdates()
        // Resolves once the installer is downloaded and its sha512 matched; it is installed when the hub quits.
        await result?.downloadPromise
      }
    }
  })
  return {
    async onReport(report, engine) {
      log(`self-update: ${JSON.stringify(await selfUpdate.onReport(report, engine))}`)
    },
    stop: () => void selfUpdate.stop()
  }
}
