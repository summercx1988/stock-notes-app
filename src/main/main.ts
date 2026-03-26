import 'dotenv/config'
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
  })

  voiceTranscriberClient.setMainWindow(mainWindow)

  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

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
