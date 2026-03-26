import * as lark from '@larksuiteoapi/node-sdk'
import { BrowserWindow } from 'electron'
import { messageHandler } from './message-handler'
import { appConfigService } from '../app-config'
import type { FeishuStatus } from '../../../shared/types'

export class FeishuBotService {
  private client: lark.Client | null = null
  private wsClient: lark.WSClient | null = null
  private eventDispatcher: lark.EventDispatcher | null = null
  private enabled: boolean = false
  private connected: boolean = false
  private error: string | undefined

  async initialize(): Promise<void> {
    const settings = await appConfigService.getAll()
    const config = settings.feishu

    if (!config?.appId || !config?.appSecret) {
      this.error = '未配置飞书应用'
      return
    }

    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu
    })

    this.eventDispatcher = new lark.EventDispatcher({
      verificationToken: config.verificationToken || '',
      encryptKey: config.encryptKey || ''
    })
  }

  async start(): Promise<void> {
    if (this.enabled && this.connected && this.wsClient) {
      console.log('[FeishuBot] Service already running, skip duplicate start')
      this.notifyStatusChange()
      return
    }

    if (this.wsClient) {
      try {
        this.wsClient.close()
      } catch (err) {
        console.error('[FeishuBot] Close stale ws client failed:', err)
      }
      this.wsClient = null
    }

    if (!this.client) {
      await this.initialize()
    }

    if (!this.client) {
      this.error = '飞书客户端未初始化'
      this.notifyStatusChange()
      return
    }

    const settings = await appConfigService.getAll()
    const config = settings.feishu

    try {
      this.eventDispatcher = new lark.EventDispatcher({
        verificationToken: config.verificationToken || '',
        encryptKey: config.encryptKey || ''
      })

      this.eventDispatcher.register({
        'im.message.receive_v1': async (data: unknown) => {
          if (!this.enabled) {
            void this.sendDisabledReply(data)
            return {}
          }
          console.log('[FeishuBot] Received message event:', JSON.stringify(data, null, 2))
          void this.processMessageEvent(data)
          return {}
        },
        'card.action.trigger': async (data: unknown) => {
          if (!this.enabled) {
            return {}
          }
          console.log('[FeishuBot] Received card action event:', JSON.stringify(data, null, 2))
          void this.processCardActionEvent(data)
          return {}
        }
      })

      this.wsClient = new lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: lark.Domain.Feishu
      })

      await this.wsClient.start({
        eventDispatcher: this.eventDispatcher
      })

      this.enabled = true
      this.connected = true
      this.error = undefined
      this.notifyStatusChange()
      console.log('[FeishuBot] Service started')
    } catch (err) {
      this.error = `启动失败: ${err instanceof Error ? err.message : String(err)}`
      this.connected = false
      this.notifyStatusChange()
      console.error('[FeishuBot] Start failed:', err)
    }
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      try {
        this.wsClient.close()
      } catch (err) {
        console.error('[FeishuBot] Stop failed:', err)
      }
      this.wsClient = null
    }
    this.enabled = false
    this.connected = false
    this.error = undefined
    this.notifyStatusChange()
    console.log('[FeishuBot] Service stopped')
  }

  getStatus(): FeishuStatus {
    return {
      enabled: this.enabled,
      connected: this.connected,
      error: this.error
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.start()
      if (this.connected) {
        await appConfigService.set('feishu.enabled', true)
      }
    } else {
      await this.stop()
      await appConfigService.set('feishu.enabled', false)
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      await this.initialize()
    }

    if (!this.client) {
      return { success: false, error: '飞书客户端未初始化，请检查配置' }
    }

    try {
      await this.client.auth.tenantAccessToken.internal({
        data: {
          app_id: (await appConfigService.getAll()).feishu.appId,
          app_secret: (await appConfigService.getAll()).feishu.appSecret
        }
      })
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: `连接失败: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  private notifyStatusChange(): void {
    const status = this.getStatus()
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('feishu:statusChanged', status)
    })
  }

  private async sendDisabledReply(data: unknown): Promise<void> {
    if (!this.client) return
    const event = data as { message?: { chat_id?: string } }
    const chatId = event?.message?.chat_id
    if (!chatId) return
    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: '远程录入服务当前未启动，请先在应用中开启后再发送。' })
        }
      })
    } catch (error) {
      console.error('[FeishuBot] Send disabled reply failed:', error)
    }
  }

  private async processMessageEvent(data: unknown): Promise<void> {
    if (!this.client) {
      return
    }
    try {
      await messageHandler.handleMessage(data, this.client)
    } catch (err) {
      console.error('[FeishuBot] Handle message error:', err)
    }
  }

  private async processCardActionEvent(data: unknown): Promise<void> {
    if (!this.client) {
      return
    }
    try {
      await messageHandler.handleCardAction(data, this.client)
    } catch (err) {
      console.error('[FeishuBot] Handle card action error:', err)
    }
  }
}

export const feishuBotService = new FeishuBotService()
