import { ipcMain } from 'electron'
import { appConfigService } from '../services/app-config'
import { watchlistService } from '../services/watchlist'
import type { UserSettings, WatchlistImportResult } from '../../shared/types'

ipcMain.handle('config:get', async (_, key: string) => {
  return appConfigService.get(key)
})

ipcMain.handle('config:getAll', async (): Promise<UserSettings> => {
  return appConfigService.getAll()
})

ipcMain.handle('config:set', async (_, key: string, value: unknown): Promise<UserSettings> => {
  return appConfigService.set(key, value)
})

ipcMain.handle('config:update', async (_, partial: Partial<UserSettings>): Promise<UserSettings> => {
  return appConfigService.update(partial)
})

ipcMain.handle('watchlist:get', async () => {
  return watchlistService.getStocks()
})

ipcMain.handle('watchlist:getCodes', async () => {
  return watchlistService.getCodes()
})

ipcMain.handle('watchlist:import', async (_, rawInput: string, mode: 'append' | 'replace' = 'append'): Promise<WatchlistImportResult> => {
  return watchlistService.importFromText(rawInput, mode)
})

ipcMain.handle('watchlist:clear', async (): Promise<boolean> => {
  await watchlistService.clear()
  return true
})
