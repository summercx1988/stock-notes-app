import type { SessionState } from './types'
import type { AIExtractResult } from '../ai-processor'

const SESSION_TIMEOUT_MS = 5 * 60 * 1000

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map()

  private getKey(messageId: string): string {
    return messageId
  }

  getSessionByMessageId(messageId: string): SessionState | undefined {
    const key = this.getKey(messageId)
    const session = this.sessions.get(key)
    if (session && Date.now() - session.updatedAt > SESSION_TIMEOUT_MS) {
      this.sessions.delete(key)
      return undefined
    }
    return session
  }

  getSession(chatId: string, openId: string): SessionState | undefined {
    for (const session of this.sessions.values()) {
      if (session.chatId === chatId && session.openId === openId) {
        if (Date.now() - session.updatedAt > SESSION_TIMEOUT_MS) {
          this.sessions.delete(session.messageId)
          return undefined
        }
        return session
      }
    }
    return undefined
  }

  createSession(messageId: string, chatId: string, openId: string, originalText: string): SessionState {
    const key = this.getKey(messageId)
    const session: SessionState = {
      messageId,
      chatId,
      openId,
      status: 'idle',
      originalText,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.sessions.set(key, session)
    return session
  }

  setAwaitingStock(messageId: string, chatId: string, openId: string, extractedData: AIExtractResult): SessionState {
    const key = this.getKey(messageId)
    let session = this.sessions.get(key)
    if (!session) {
      session = this.createSession(messageId, chatId, openId, extractedData.originalText)
    }
    const updated = {
      ...session,
      status: 'awaiting_stock' as const,
      extractedData,
      updatedAt: Date.now()
    }
    this.sessions.set(key, updated)
    return updated
  }

  setAwaitingConfirm(messageId: string, chatId: string, openId: string, extractedData: AIExtractResult): SessionState {
    const key = this.getKey(messageId)
    let session = this.sessions.get(key)
    if (!session) {
      session = this.createSession(messageId, chatId, openId, extractedData.originalText)
    }
    const updated = {
      ...session,
      status: 'awaiting_confirm' as const,
      extractedData,
      updatedAt: Date.now()
    }
    this.sessions.set(key, updated)
    return updated
  }

  clearSessionByMessageId(messageId: string): void {
    const key = this.getKey(messageId)
    this.sessions.delete(key)
  }
}

export const sessionManager = new SessionManager()
