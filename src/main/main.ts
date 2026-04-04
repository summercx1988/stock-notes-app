import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { voiceTranscriberClient } from './services/VoiceTranscriberClient'
import { feishuBotService } from './services/feishu-bot'
import { appConfigService } from './services/app-config'
import { sharedNotesService } from './application/container'
import { AIService } from './services/ai'
import { DailyReviewService } from './services/daily-review'
import { DailyReviewReminderScheduler } from './services/daily-review/reminder-scheduler'
import { registerDailyReviewIPC } from './ipc/daily-review'
import { appLogger, installConsoleFileTransport } from './services/app-logger'

installConsoleFileTransport()
appLogger.info('Main', 'Main process bootstrapping', {
  pid: process.pid,
  nodeEnv: process.env.NODE_ENV || 'production',
  logFilePath: appLogger.getLogFilePath()
})

let mainWindow: BrowserWindow | null = null
let dailyReviewReminderScheduler: DailyReviewReminderScheduler | null = null
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Main] Failed to load:', errorCode, errorDescription)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: '股票投资笔记',
      submenu: [
        {
          label: '关于股票投资笔记',
          role: 'about'
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: async () => {
            console.log('[Main] User requested quit via menu')
            await voiceTranscriberClient.stop()
            await feishuBotService.stop()
            app.quit()
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)
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
  appLogger.info('Main', 'Electron app ready', {
    logFilePath: appLogger.getLogFilePath()
  })
  createWindow()

  const aiService = new AIService()
  const dailyReviewService = new DailyReviewService(sharedNotesService, aiService)
  
  try {
    await aiService.initialize()
    console.log('[Main] AI service initialized')
  } catch (error) {
    console.warn('[Main] AI service initialization failed:', error)
  }

  registerDailyReviewIPC(dailyReviewService)
  console.log('[Main] Daily review service registered')
  dailyReviewReminderScheduler = new DailyReviewReminderScheduler(dailyReviewService)
  dailyReviewReminderScheduler.start()
  console.log('[Main] Daily review reminder scheduler started')

  setTimeout(async () => {
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
  }, 200)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let isQuitting = false

app.on('before-quit', async (event) => {
  if (isQuitting) return
  
  event.preventDefault()
  isQuitting = true
  
  console.log('[Main] Cleaning up before quit...')
  
  try {
    await Promise.all([
      voiceTranscriberClient.stop(),
      feishuBotService.stop()
    ])
    dailyReviewReminderScheduler?.stop()
    console.log('[Main] All services stopped')
  } catch (error) {
    console.error('[Main] Error stopping services:', error)
  }
  
  app.exit(0)
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
import './ipc/daily-review'
