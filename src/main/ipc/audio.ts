import { ipcMain } from 'electron'
import { AudioService } from '../services/audio'
import fs from 'fs/promises'
import path from 'path'

const audioService = new AudioService()

ipcMain.handle('audio:startRecording', async () => {
  return audioService.startRecording()
})

ipcMain.handle('audio:stopRecording', async () => {
  return audioService.stopRecording()
})

ipcMain.handle('audio:importFile', async (_, filePath: string) => {
  return audioService.importFile(filePath)
})

ipcMain.handle('audio:convert', async (_, inputPath: string, format: string) => {
  return audioService.convert(inputPath, format)
})

ipcMain.handle('audio:saveRecording', async (_, buffer: ArrayBuffer, filename: string) => {
  const audioDir = path.join(process.cwd(), 'data', 'audio', 'temp')
  await fs.mkdir(audioDir, { recursive: true })
  const filePath = path.join(audioDir, filename)
  await fs.writeFile(filePath, Buffer.from(buffer))
  return filePath
})
