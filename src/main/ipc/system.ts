import { dialog, ipcMain } from 'electron'

ipcMain.handle('system:pickDirectory', async (_, defaultPath?: string): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: '选择目录',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})
