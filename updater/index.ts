import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { logService } from '../backend/services/log.service'

export function initUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logService.info('UPDATER', 'Provjera ažuriranja...')
    win.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    logService.info('UPDATER', `Dostupna nova verzija: ${info.version}`)
    win.webContents.send('update:available', info)
  })

  autoUpdater.on('update-not-available', () => {
    logService.success('UPDATER', 'Koristite najnoviju verziju launchera')
    win.webContents.send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update:progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    logService.success('UPDATER', `Ažuriranje preuzeto: ${info.version}. Restart za instalaciju.`)
    win.webContents.send('update:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    logService.warning('UPDATER', `Greška provjere ažuriranja: ${err.message}`)
  })

  // Check for updates 5 seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Ignore update check errors in dev mode
    })
  }, 5000)
}
