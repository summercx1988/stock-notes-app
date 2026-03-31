import { app, BrowserWindow } from 'electron'
import path from 'path'
import { voiceTranscriberClient } from './services/VoiceTranscriberClient'
import { feishuBotService } from './services/feishu-bot'
import { appConfigService } from './services/app-config'
import { sharedNotesService } from './application/container'

let mainWindow: BrowserWindow | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  console.log('[Main] Another instance is already running, quitting current process')
  app.quit()
}

function createWindow() {
  console.log('[Main] Creating main window...')
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
  })
  console.log('[Main] Window created, setting up handlers...')

  voiceTranscriberClient.setMainWindow(mainWindow)

  const isDev = process.env.NODE_ENV === 'development'
  console.log('[Main] Environment:', isDev ? 'development' : 'production')
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    const appPath = app.getAppPath()
    console.log('[Main] App path:', appPath)
    const htmlPath = path.join(appPath, 'dist/renderer/index.html')
    console.log('[Main] Loading HTML from:', htmlPath)
    mainWindow.loadFile(htmlPath)
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Window content loaded successfully')
  })

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Main] Failed to load:', errorCode, errorDescription)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })
}

app.whenReady().then(async () => {
  console.log('[Main] App is ready')
  createWindow()

  try {
    const migration = await sharedNotesService.migrateLegacyViewpointTerminology()
    if (migration.migratedFiles > 0) {
      console.log(
        `[Main] Viewpoint migration completed: migrated ${migration.migratedFiles}/${migration.scannedFiles} files (中性 -> 震荡)`
      )
    }
  } catch (error) {
    console.warn('[Main] Viewpoint migration failed:', error)
  }

  const config = await appConfigService.getAll()
  if (config.feishu?.enabled) {
    console.log('[Main] Auto-starting Feishu bot service')
    await feishuBotService.start()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  await voiceTranscriberClient.stop()
  await feishuBotService.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await voiceTranscriberClient.stop()
  await feishuBotService.stop()
})

import './ipc/notes'
import './ipc/ai'
import './ipc/audio'
import './ipc/stock'
import './ipc/review'
import './ipc/timeline'
import './ipc/config'
import './ipc/system'
import './ipc/feishu'
