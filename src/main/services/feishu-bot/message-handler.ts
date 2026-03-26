import { createHash } from 'crypto'
import * as lark from '@larksuiteoapi/node-sdk'
import { AIProcessor } from '../ai-processor'
import { stockDatabase, type SearchResult } from '../stock-db'
import { sessionManager } from './session-manager'
import { cardBuilder } from './card-builder'
import type { CardAction, CardActionPayload, FeishuMessage } from './types'
import { sharedNotesService } from '../../application/container'
import { notifyNotesChanged } from '../notes-events'

interface MessageMetrics {
  totalMessages: number
  stockResolved: number
  disambiguationRequired: number
  cardConfirmed: number
  schemaRejected: number
  duplicateMessages: number
  duplicateActions: number
}

interface SaveEditNormalized {
  stockCode: string
  stockName: string
  category: '看盘预测' | '普通笔记'
  viewpoint?: '看多' | '看空' | '震荡' | '未知'
  operationTag?: '买入' | '卖出' | '无'
  eventTime: Date
  content: string
}

export class MessageHandler {
  private readonly aiProcessor: AIProcessor
  private readonly recentIncomingMessages = new Map<string, number>()
  private readonly recentHandledActions = new Map<string, number>()
  private readonly recentSavedWrites = new Map<string, number>()
  private readonly metrics: MessageMetrics = {
    totalMessages: 0,
    stockResolved: 0,
    disambiguationRequired: 0,
    cardConfirmed: 0,
    schemaRejected: 0,
    duplicateMessages: 0,
    duplicateActions: 0
  }

  constructor() {
    this.aiProcessor = new AIProcessor()
    console.log('[FeishuBot] MessageHandler initialized')
    console.log('[FeishuBot] NotesService notesDir:', sharedNotesService.getNotesDir())
  }

  async handleMessage(event: unknown, client: lark.Client): Promise<void> {
    const message = this.parseMessage(event)
    if (!message) return
    this.metrics.totalMessages += 1

    if (this.isDuplicateIncomingMessage(message.messageId)) {
      this.metrics.duplicateMessages += 1
      console.log('[FeishuBot] Duplicate message ignored:', message.messageId)
      this.logMetricsSnapshot()
      return
    }

    console.log('[FeishuBot] Received message:', message.text)
    const session = sessionManager.getSession(message.chatId, message.openId)

    if (session?.status === 'awaiting_stock') {
      await this.handleStockInput(message, client)
      return
    }

    try {
      console.log('[FeishuBot] Calling AI extract...')
      const extracted = await this.aiProcessor.extractForFeishu(message.text)
      console.log('[FeishuBot] AI extract result:', JSON.stringify(extracted, null, 2))

      if (extracted.stock) {
        this.metrics.stockResolved += 1
      }
      if (extracted.needsUserDisambiguation || !extracted.stock) {
        this.metrics.disambiguationRequired += 1
      }

      if (!extracted.stock || extracted.needsUserDisambiguation) {
        console.log('[FeishuBot] Need disambiguation, sending ask stock card')
        await this.sendAskStockCard(message, client, extracted)
        this.logMetricsSnapshot()
        return
      }

      console.log('[FeishuBot] Stock resolved, sending confirm card')
      await this.sendConfirmCard(
        { messageId: message.messageId, chatId: message.chatId, openId: message.openId },
        client,
        extracted
      )
      this.logMetricsSnapshot()
    } catch (error) {
      console.error('[FeishuBot] Message handling failed:', error)
      await this.sendErrorCard(message.chatId, client, '处理消息时发生错误，请稍后重试')
    }
  }

  async handleCardAction(event: unknown, client: lark.Client): Promise<void> {
    console.log('\n========== 飞书卡片回调 ==========')
    console.log('[FeishuBot] 🔔 handleCardAction called')
    console.log('[FeishuBot] Raw event:', JSON.stringify(event, null, 2).slice(0, 3000))

    const eventObj = event as Record<string, unknown>
    const action = eventObj.action as Record<string, unknown> | undefined
    const actionValue = action?.value as Record<string, unknown> | undefined
    const formValue = action?.form_value as Record<string, string> | undefined
    const operator = eventObj.operator as Record<string, string> | undefined
    const openId = operator?.open_id || (eventObj.open_id as string | undefined)

    console.log('[FeishuBot] action.value:', JSON.stringify(actionValue, null, 2))
    console.log('[FeishuBot] action.form_value:', JSON.stringify(formValue, null, 2))

    if (!actionValue) {
      console.log('[FeishuBot] ❌ No action.value in event')
      console.log('================================\n')
      return
    }

    const payload = this.parseCardActionPayload(actionValue)
    const actionType = payload.action
    const chatId = payload.chatId
    const messageId = payload.messageId

    if (!openId) {
      console.log('[FeishuBot] ❌ Missing openId:', openId)
      console.log('================================\n')
      return
    }
    if (!chatId) {
      console.log('[FeishuBot] ❌ Missing chatId')
      console.log('================================\n')
      return
    }
    if (!messageId) {
      console.log('[FeishuBot] ❌ Missing messageId - 卡片可能过旧，请重新发送消息')
      console.log('================================\n')
      return
    }

    console.log('[FeishuBot] 📋 Action type:', actionType)
    console.log('[FeishuBot] 📋 messageId:', messageId)

    const dedupKey = this.buildCardActionDedupKey(messageId, actionType, payload, formValue)
    if ((actionType === 'confirm' || actionType === 'save_edit' || actionType === 'provide_stock') && this.isDuplicateCardAction(dedupKey)) {
      this.metrics.duplicateActions += 1
      console.log('[FeishuBot] Duplicate card action ignored:', dedupKey)
      this.logMetricsSnapshot()
      console.log('================================\n')
      return
    }

    switch (actionType) {
      case 'confirm': {
        console.log('[FeishuBot] ✅ Processing confirm action')
        const session = sessionManager.getSessionByMessageId(messageId)
        if (!session?.extractedData) {
          await this.sendTextMessage(chatId, client, '会话已过期，请重新发送消息')
          console.log('================================\n')
          return
        }
        await this.handleConfirm(messageId, chatId, client, session.extractedData)
        break
      }
      case 'provide_stock':
        await this.handleProvideStockSelection(messageId, chatId, openId, client, payload)
        break
      case 'cancel':
        sessionManager.clearSessionByMessageId(messageId)
        await this.sendTextMessage(chatId, client, '已取消保存')
        break
      case 'edit': {
        console.log('[FeishuBot] 📝 Processing edit action')
        const session = sessionManager.getSessionByMessageId(messageId)
        console.log('[FeishuBot] 📝 Session for edit:', session ? 'found' : 'not found')
        if (!session?.extractedData) {
          await this.sendTextMessage(chatId, client, '会话已过期，请重新发送消息')
          console.log('================================\n')
          return
        }
        await this.sendEditCard(messageId, chatId, client, session.extractedData)
        console.log('[FeishuBot] 📝 Edit card sent')
        break
      }
      case 'save_edit':
        console.log('[FeishuBot] 💾 Processing save_edit action')
        console.log('[FeishuBot] 💾 formValue:', JSON.stringify(formValue))
        await this.handleSaveEdit(messageId, chatId, client, this.buildSaveEditAction(chatId, payload, formValue))
        break
      default:
        console.log('[FeishuBot] ❓ Unknown action type:', actionType)
    }
    this.logMetricsSnapshot()
    console.log('================================\n')
  }

  private async handleStockInput(message: FeishuMessage, client: lark.Client): Promise<void> {
    const session = sessionManager.getSession(message.chatId, message.openId)
    if (!session?.extractedData) {
      await this.sendTextMessage(message.chatId, client, '会话已过期，请重新发送消息')
      return
    }

    const stockInput = message.text.trim()
    const resolved = await this.resolveStockFromInput(stockInput)
    if (!resolved) {
      await this.sendTextMessage(message.chatId, client, `未找到股票"${stockInput}"，请确认股票名称或代码是否正确`)
      return
    }

    const merged = {
      ...session.extractedData,
      stock: {
        code: resolved.stock.code,
        name: resolved.stock.name,
        confidence: 0.99
      },
      stockConfidence: 0.99,
      needsUserDisambiguation: false
    }
    await this.sendConfirmCard(
      { messageId: message.messageId, chatId: message.chatId, openId: message.openId },
      client,
      merged
    )
  }

  private async handleProvideStockSelection(
    messageId: string,
    chatId: string,
    openId: string,
    client: lark.Client,
    payload: CardActionPayload
  ): Promise<void> {
    const session = sessionManager.getSessionByMessageId(messageId)
    if (!session?.extractedData) {
      await this.sendTextMessage(chatId, client, '会话已过期，请重新发送消息')
      return
    }

    const stockInput = payload.stockCode || payload.stockName
    if (!stockInput) {
      await this.sendTextMessage(chatId, client, '候选股票数据无效，请重新发送消息')
      return
    }

    const resolved = await this.resolveStockFromInput(stockInput)
    if (!resolved) {
      await this.sendTextMessage(chatId, client, '候选股票解析失败，请手动输入股票代码')
      return
    }

    const merged = {
      ...session.extractedData,
      stock: {
        code: resolved.stock.code,
        name: resolved.stock.name,
        confidence: 0.99
      },
      stockConfidence: 0.99,
      needsUserDisambiguation: false,
      decisionReason: [...(session.extractedData.decisionReason || []), '用户通过候选按钮确认股票']
    }

    await this.sendConfirmCard(
      { messageId, chatId, openId },
      client,
      merged
    )
  }

  private async handleConfirm(
    messageId: string,
    chatId: string,
    client: lark.Client,
    extracted: Awaited<ReturnType<AIProcessor['extract']>>
  ): Promise<void> {
    if (!extracted.stock) {
      await this.sendErrorCard(chatId, client, '股票信息缺失')
      return
    }

    try {
      const content = extracted.optimizedText || extracted.originalText
      const saveKey = this.buildSaveDedupKey(messageId, extracted.stock.code, content, '')
      if (this.isDuplicateSave(saveKey)) {
        await this.sendTextMessage(chatId, client, '重复提交已忽略')
        return
      }

      const entry = await sharedNotesService.addEntry(extracted.stock.code, {
        content,
        title: extracted.note.keyPoints[0] || '远程录入笔记',
        category: '看盘预测',
        operationTag: this.normalizeOperationTagStrict(extracted.note.operationTag) || '无',
        viewpoint: extracted.note.sentiment ? {
          direction: this.normalizeViewpointStrict(extracted.note.sentiment) || '未知',
          confidence: extracted.stock.confidence,
          timeHorizon: extracted.note.timeHorizon || '短线'
        } : undefined,
        inputType: 'manual'
      })

      this.metrics.cardConfirmed += 1
      notifyNotesChanged({
        stockCode: extracted.stock.code,
        entryId: entry.id,
        action: 'created',
        source: 'feishu'
      })

      sessionManager.clearSessionByMessageId(messageId)
      void this.sendSuccessCard(chatId, client, extracted.stock.name, extracted.stock.code)
    } catch (error) {
      console.error('[FeishuBot] Save note failed:', error)
      void this.sendErrorCard(chatId, client, '保存笔记失败，请稍后重试')
    }
  }

  private parseMessage(event: unknown): FeishuMessage | null {
    const eventObj = event as Record<string, unknown>
    const messageObj = eventObj.message as Record<string, unknown> | undefined
    if (!messageObj) return null

    let text = ''
    try {
      const content = JSON.parse((messageObj.content as string) || '{}')
      text = content.text || ''
    } catch {
      text = (messageObj.content as string) || ''
    }
    if (!text.trim()) return null

    const sender = eventObj.sender as Record<string, unknown> | undefined
    const senderId = sender?.sender_id as Record<string, string> | undefined

    return {
      messageId: messageObj.message_id as string,
      chatId: messageObj.chat_id as string,
      openId: senderId?.open_id || '',
      text: text.trim(),
      timestamp: Date.now()
    }
  }

  private async sendConfirmCard(
    meta: { messageId: string; chatId: string; openId: string },
    client: lark.Client,
    extracted: Awaited<ReturnType<AIProcessor['extract']>>
  ): Promise<void> {
    if (!extracted.stock) return

    sessionManager.setAwaitingConfirm(meta.messageId, meta.chatId, meta.openId, extracted)

    const eventTime = extracted.timestamp?.type !== 'none' && extracted.timestamp?.value
      ? this.formatEventTime(extracted.timestamp.value)
      : this.formatEventTime(new Date())

    const card = cardBuilder.buildConfirmCard({
      stockName: extracted.stock.name,
      stockCode: extracted.stock.code,
      viewpoint: extracted.note.sentiment || '未知',
      operationTag: extracted.note.operationTag || '无',
      keyPoints: extracted.note.keyPoints,
      originalText: extracted.originalText,
      confidence: extracted.stock.confidence,
      chatId: meta.chatId,
      messageId: meta.messageId,
      eventTime
    })

    await this.sendCardMessage(meta.chatId, client, card)
  }

  private formatEventTime(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }

  private async sendAskStockCard(
    message: FeishuMessage,
    client: lark.Client,
    extracted: Awaited<ReturnType<AIProcessor['extract']>>
  ): Promise<void> {
    sessionManager.setAwaitingStock(message.messageId, message.chatId, message.openId, extracted)

    const card = cardBuilder.buildAskStockCard({
      chatId: message.chatId,
      messageId: message.messageId,
      originalText: extracted.originalText,
      message: '未能准确识别股票信息，请点击候选股票或直接回复股票名称/代码',
      candidates: extracted.stockCandidates || []
    })

    await this.sendCardMessage(message.chatId, client, card)
  }

  private async sendSuccessCard(chatId: string, client: lark.Client, stockName: string, stockCode: string): Promise<void> {
    const card = cardBuilder.buildSuccessCard(stockName, stockCode)
    await this.sendCardMessage(chatId, client, card)
  }

  private async sendErrorCard(chatId: string, client: lark.Client, errorMessage: string): Promise<void> {
    const card = cardBuilder.buildErrorCard(errorMessage)
    await this.sendCardMessage(chatId, client, card)
  }

  private async sendEditCard(
    messageId: string,
    chatId: string,
    client: lark.Client,
    extracted: Awaited<ReturnType<AIProcessor['extract']>>
  ): Promise<void> {
    if (!extracted.stock) return

    const eventTime = extracted.timestamp?.type !== 'none' && extracted.timestamp?.value
      ? this.formatEventTime(extracted.timestamp.value)
      : this.formatEventTime(new Date())

    const card = cardBuilder.buildEditCard({
      messageId,
      chatId,
      stockName: extracted.stock.name,
      stockCode: extracted.stock.code,
      viewpoint: extracted.note.sentiment || '未知',
      operationTag: extracted.note.operationTag || '无',
      eventTime,
      category: '看盘预测',
      originalText: this.resolveSessionContent(extracted) || extracted.originalText
    })

    console.log('[FeishuBot] 🧾 Edit card form names:', JSON.stringify(this.collectFormNames(card)))
    console.log('[FeishuBot] 🧾 Edit card JSON:', JSON.stringify(card, null, 2))

    await this.sendCardMessage(chatId, client, card)
  }

  private async handleSaveEdit(
    messageId: string,
    chatId: string,
    client: lark.Client,
    action: CardAction
  ): Promise<void> {
    if (!action.formData) {
      await this.sendTextMessage(chatId, client, '表单数据丢失，请重新操作')
      return
    }

    const normalized = await this.validateAndNormalizeSaveEdit(messageId, action)
    if (!normalized.valid) {
      this.metrics.schemaRejected += 1
      await this.sendErrorCard(chatId, client, normalized.error || '卡片数据不合法，请重新编辑')
      return
    }

    try {
      const payload = normalized.value!
      const content = payload.content || '远程录入笔记'
      const saveKey = this.buildSaveDedupKey(messageId, payload.stockCode, content, payload.eventTime.toISOString())
      if (this.isDuplicateSave(saveKey)) {
        await this.sendTextMessage(chatId, client, '重复提交已忽略')
        return
      }

      const entry = await sharedNotesService.addEntry(payload.stockCode, {
        content,
        title: '远程录入笔记',
        category: payload.category,
        operationTag: payload.operationTag,
        eventTime: payload.eventTime,
        viewpoint: payload.viewpoint ? {
          direction: payload.viewpoint,
          confidence: payload.category === '看盘预测' ? 1 : 0,
          timeHorizon: '短线'
        } : undefined,
        inputType: 'manual'
      })

      this.metrics.cardConfirmed += 1
      notifyNotesChanged({
        stockCode: payload.stockCode,
        entryId: entry.id,
        action: 'created',
        source: 'feishu'
      })
      sessionManager.clearSessionByMessageId(messageId)
      void this.sendSuccessCard(chatId, client, payload.stockName, payload.stockCode)
    } catch (error) {
      console.error('[FeishuBot] Save edited note failed:', error)
      void this.sendErrorCard(chatId, client, '保存笔记失败，请稍后重试')
    }
  }

  private parseCardActionPayload(raw?: Record<string, unknown>): CardActionPayload {
    return {
      schemaVersion: raw?.schemaVersion === '1.0'
        ? '1.0'
        : raw?.schemaVersion === '2.0'
          ? '2.0'
          : 'legacy',
      action: String(raw?.action || '') as CardActionPayload['action'],
      chatId: typeof raw?.chatId === 'string' ? raw.chatId : undefined,
      messageId: typeof raw?.messageId === 'string' ? raw.messageId : undefined,
      stockCode: typeof raw?.stockCode === 'string' ? raw.stockCode : undefined,
      stockName: typeof raw?.stockName === 'string' ? raw.stockName : undefined,
      category: typeof raw?.category === 'string' ? raw.category : undefined,
      viewpoint: typeof raw?.viewpoint === 'string' ? raw.viewpoint : undefined,
      operationTag: typeof raw?.operationTag === 'string' ? raw.operationTag : undefined,
      eventTime: typeof raw?.eventTime === 'string' ? raw.eventTime : undefined
    }
  }

  private buildSaveEditAction(
    chatId: string,
    payload?: CardActionPayload,
    formValue?: Record<string, string>
  ): CardAction {
    const formEntries = Object.entries(formValue || {})
    const findFormValue = (prefix: string): string | undefined => formEntries.find(([key]) => key.startsWith(prefix))?.[1]

    return {
      action: 'save_edit',
      chatId,
      stockCode: payload?.stockCode,
      stockName: payload?.stockName,
      viewpoint: payload?.viewpoint,
      operationTag: payload?.operationTag,
      eventTime: payload?.eventTime,
      formData: {
        stockInput: formValue?.stock_input || findFormValue('stock_input_') || payload?.stockCode || payload?.stockName,
        contentInput: formValue?.content_input || findFormValue('content_input_'),
        categorySelect: formValue?.category_select || findFormValue('category_select_') || payload?.category || '看盘预测',
        viewpointSelect: formValue?.viewpoint_select || findFormValue('viewpoint_select_') || payload?.viewpoint,
        operationSelect: formValue?.operation_select || findFormValue('operation_select_') || payload?.operationTag,
        eventTimeInput: formValue?.event_time_input || findFormValue('event_time_input_') || payload?.eventTime
      }
    }
  }

  private async validateAndNormalizeSaveEdit(
    messageId: string,
    action: CardAction
  ): Promise<{ valid: true; value: SaveEditNormalized } | { valid: false; error: string }> {
    const stockInput = action.formData?.stockInput || action.stockCode || action.stockName
    if (!stockInput) {
      return { valid: false, error: '股票名称或代码不能为空' }
    }

    const stockMatch = await this.resolveStockFromInput(stockInput)
    if (!stockMatch) {
      return { valid: false, error: `未找到股票 "${stockInput}"` }
    }

    const categoryRaw = action.formData?.categorySelect || '看盘预测'
    const category = this.normalizeCategory(categoryRaw)
    const viewpointRaw = action.formData?.viewpointSelect || action.viewpoint || '未知'
    const operationRaw = action.formData?.operationSelect || action.operationTag || '无'
    const eventTimeRaw = action.formData?.eventTimeInput || action.eventTime

    const viewpoint = this.normalizeViewpointStrict(viewpointRaw)
    const operationTag = this.normalizeOperationTagStrict(operationRaw)
    if (category === '看盘预测') {
      if (!viewpoint) {
        return { valid: false, error: '预测笔记的观点字段非法，仅支持：看多/看空/震荡/未知' }
      }
      if (!operationTag) {
        return { valid: false, error: '预测笔记的操作字段非法，仅支持：买入/卖出/无' }
      }
    }
    if (!eventTimeRaw) {
      return { valid: false, error: '事件时间不能为空' }
    }
    const eventTime = this.parseEventTime(eventTimeRaw)
    if (Number.isNaN(eventTime.getTime())) {
      return { valid: false, error: '事件时间格式错误，请使用 YYYY-MM-DD HH:mm' }
    }

    const session = sessionManager.getSessionByMessageId(messageId)
    const extractedData = session?.extractedData
    const sessionContent = extractedData
      ? this.resolveSessionContent(extractedData)
      : ''
    const content = String(
      action.formData?.contentInput
      || sessionContent
      || session?.extractedData?.originalText
      || ''
    ).trim()
    if (!content) {
      return { valid: false, error: '笔记正文不能为空' }
    }

    return {
      valid: true,
      value: {
        stockCode: stockMatch.stock.code,
        stockName: stockMatch.stock.name,
        category,
        viewpoint: category === '看盘预测' ? (viewpoint || '未知') : viewpoint || undefined,
        operationTag: category === '看盘预测' ? (operationTag || '无') : operationTag || undefined,
        eventTime,
        content
      }
    }
  }

  private normalizeCategory(value: unknown): '看盘预测' | '普通笔记' {
    if (typeof value !== 'string') return '看盘预测'
    const text = value.trim()
    if (text === '看盘预测' || text === '普通笔记') {
      return text
    }
    return '看盘预测'
  }

  private normalizeViewpointStrict(value: unknown): '看多' | '看空' | '震荡' | '未知' | null {
    if (typeof value !== 'string') return null
    const text = value.trim()
    if (!text) return null
    if (text === '看多') return '看多'
    if (text === '看空') return '看空'
    if (text === '震荡' || text === '中性') return '震荡'
    if (text === '未知') return '未知'
    return null
  }

  private normalizeOperationTagStrict(value: unknown): '买入' | '卖出' | '无' | null {
    if (typeof value !== 'string') return null
    const text = value.trim()
    if (!text) return null
    if (text === '买入') return '买入'
    if (text === '卖出') return '卖出'
    if (text === '无') return '无'
    return null
  }

  private async resolveStockFromInput(input: string): Promise<SearchResult | null> {
    await stockDatabase.ensureLoaded()
    const trimmed = String(input || '').trim()
    const codeMatch = trimmed.match(/(\d{6})/)
    if (codeMatch) {
      const stock = stockDatabase.getByCode(codeMatch[1])
      if (stock) {
        return { stock, matchType: 'code', score: 100 }
      }
    }
    return stockDatabase.search(trimmed, 1)[0] || null
  }

  private parseEventTime(input: string): Date {
    const normalized = String(input || '').trim()
    if (!normalized) return new Date(NaN)

    const zonedMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(:\d{2})?\s+([+-]\d{4})$/)
    if (zonedMatch) {
      const [, datePart, timePart, secondsPart = '', offsetPart] = zonedMatch
      const offset = `${offsetPart.slice(0, 3)}:${offsetPart.slice(3)}`
      return new Date(`${datePart}T${timePart}${secondsPart}${offset}`)
    }

    const direct = new Date(normalized)
    if (!Number.isNaN(direct.getTime())) {
      return direct
    }
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
      return new Date(normalized.replace(' ', 'T'))
    }
    return new Date(NaN)
  }

  private buildCardActionDedupKey(
    messageId: string,
    actionType: string,
    payload: CardActionPayload,
    formValue?: Record<string, string>
  ): string {
    const normalizedPayload = JSON.stringify({
      actionType,
      payload,
      formValue: formValue || {}
    })
    const hash = createHash('sha1').update(normalizedPayload).digest('hex').slice(0, 12)
    return `${messageId}:${actionType}:${hash}`
  }

  private buildSaveDedupKey(messageId: string, stockCode: string, content: string, eventTimeIso: string): string {
    const payloadHash = createHash('sha1')
      .update(`${stockCode}|${content}|${eventTimeIso}`)
      .digest('hex')
      .slice(0, 12)
    return `${messageId}:${payloadHash}`
  }

  private resolveSessionContent(extracted: Awaited<ReturnType<AIProcessor['extract']>>): string {
    const optimized = String(extracted.optimizedText || '').trim()
    if (optimized) return optimized
    const original = String(extracted.originalText || '').trim()
    if (original) return original
    return ''
  }

  private isDuplicateIncomingMessage(messageId: string): boolean {
    return this.rememberWithTtl(this.recentIncomingMessages, messageId, 10 * 60 * 1000)
  }

  private isDuplicateCardAction(key: string): boolean {
    return this.rememberWithTtl(this.recentHandledActions, key, 2 * 60 * 1000)
  }

  private isDuplicateSave(key: string): boolean {
    return this.rememberWithTtl(this.recentSavedWrites, key, 10 * 60 * 1000)
  }

  private rememberWithTtl(store: Map<string, number>, key: string, ttlMs: number): boolean {
    const now = Date.now()
    for (const [existingKey, timestamp] of store.entries()) {
      if (now - timestamp > ttlMs) {
        store.delete(existingKey)
      }
    }
    if (store.has(key)) {
      return true
    }
    store.set(key, now)
    return false
  }

  private logMetricsSnapshot(): void {
    if (this.metrics.totalMessages % 20 !== 0) return
    const total = this.metrics.totalMessages || 1
    const payload = {
      total_messages: this.metrics.totalMessages,
      stock_resolved: this.metrics.stockResolved,
      stock_resolved_rate: Number((this.metrics.stockResolved / total).toFixed(4)),
      disambiguation_required: this.metrics.disambiguationRequired,
      disambiguation_rate: Number((this.metrics.disambiguationRequired / total).toFixed(4)),
      card_confirmed: this.metrics.cardConfirmed,
      schema_rejected: this.metrics.schemaRejected,
      duplicate_messages: this.metrics.duplicateMessages,
      duplicate_actions: this.metrics.duplicateActions
    }
    console.log('[FeishuBot][Metrics]', JSON.stringify(payload))
  }

  private async sendCardMessage(chatId: string, client: lark.Client, card: object): Promise<void> {
    try {
      const content = JSON.stringify(card)
      const response = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content
        }
      })
      console.log('[FeishuBot] 📤 Interactive card sent:', {
        chatId,
        messageId: response.data?.message_id,
        schema: (card as { schema?: string }).schema || '1.0',
        headerTitle: this.resolveCardHeaderTitle(card),
        contentLength: content.length
      })
    } catch (error) {
      console.error('[FeishuBot] Send card message failed:', error)
    }
  }

  private async sendTextMessage(chatId: string, client: lark.Client, text: string): Promise<void> {
    try {
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text })
        }
      })
    } catch (error) {
      console.error('[FeishuBot] Send text message failed:', error)
    }
  }

  private collectFormNames(card: object): string[] {
    const names: string[] = []
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(visit)
        return
      }

      const record = node as Record<string, unknown>
      if (typeof record.name === 'string' && record.name.trim()) {
        names.push(record.name)
      }

      Object.values(record).forEach(visit)
    }

    visit(card)
    return Array.from(new Set(names))
  }

  private resolveCardHeaderTitle(card: object): string {
    const header = (card as { header?: { title?: { content?: string } } }).header
    return header?.title?.content || 'unknown'
  }
}

export const messageHandler = new MessageHandler()
