import { ipcMain } from 'electron'
import { feishuBotService } from '../services/feishu-bot'
import type { FeishuStatus } from '../../shared/types'

ipcMain.handle('feishu:setEnabled', async (_, enabled: boolean): Promise<void> => {
  await feishuBotService.setEnabled(enabled)
})

ipcMain.handle('feishu:getStatus', async (): Promise<FeishuStatus> => {
  return feishuBotService.getStatus()
})

ipcMain.handle('feishu:testConnection', async (): Promise<{ success: boolean; error?: string }> => {
  return feishuBotService.testConnection()
})
