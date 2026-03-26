import type { ConfirmCardData, AskStockCardData } from './types'

export class CardBuilder {
  private buildCallbackBehaviors(payload: Record<string, string>): Array<{ type: 'callback'; value: Record<string, string> }> {
    return [
      {
        type: 'callback',
        value: {
          schemaVersion: '2.0',
          ...payload
        }
      }
    ]
  }

  private buildButton(options: {
    text: string
    type?: 'default' | 'primary' | 'primary_filled' | 'danger' | 'text'
    payload: Record<string, string>
    width?: 'default' | 'fill'
  }): object {
    return {
      tag: 'button',
      text: { tag: 'plain_text', content: options.text },
      type: options.type || 'default',
      width: options.width || 'default',
      behaviors: this.buildCallbackBehaviors(options.payload)
    }
  }

  buildConfirmCard(data: ConfirmCardData): object {
    const confidenceText = data.confidence >= 0.9
      ? '🟢 高置信度'
      : data.confidence >= 0.7
        ? '🟡 中等置信度'
        : '🔴 低置信度'

    return {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '📝 笔记确认' },
        template: 'blue'
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: [
              `**股票**：${data.stockName} (${data.stockCode})`,
              '**笔记类型**：看盘预测',
              `**观点**：${data.viewpoint || '未知'}`,
              `**操作**：${data.operationTag || '无'}`,
              `**事件时间**：${data.eventTime}`,
              `**置信度**：${confidenceText}`
            ].join('\n'),
            text_align: 'left',
            text_size: 'normal'
          },
          {
            tag: 'markdown',
            content: `**原文**\n${data.originalText.slice(0, 300)}${data.originalText.length > 300 ? '...' : ''}`,
            text_align: 'left',
            text_size: 'normal'
          },
          {
            tag: 'column_set',
            flex_mode: 'flow',
            horizontal_spacing: '8px',
            columns: [
              {
                tag: 'column',
                width: 'auto',
                elements: [
                  this.buildButton({
                    text: '确认保存',
                    type: 'primary_filled',
                    payload: {
                      action: 'confirm',
                      chatId: data.chatId,
                      messageId: data.messageId
                    }
                  })
                ]
              },
              {
                tag: 'column',
                width: 'auto',
                elements: [
                  this.buildButton({
                    text: '修改',
                    payload: {
                      action: 'edit',
                      chatId: data.chatId,
                      messageId: data.messageId,
                      stockName: data.stockName,
                      stockCode: data.stockCode,
                      viewpoint: data.viewpoint,
                      operationTag: data.operationTag,
                      eventTime: data.eventTime,
                      category: '看盘预测'
                    }
                  })
                ]
              },
              {
                tag: 'column',
                width: 'auto',
                elements: [
                  this.buildButton({
                    text: '取消',
                    payload: {
                      action: 'cancel',
                      chatId: data.chatId,
                      messageId: data.messageId
                    }
                  })
                ]
              }
            ]
          }
        ]
      }
    }
  }

  buildEditCard(data: {
    messageId: string
    chatId: string
    stockName: string
    stockCode: string
    viewpoint: string
    operationTag: string
    eventTime: string
    category: string
    originalText: string
  }): object {
    const shortId = data.messageId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'edit'
    const buildCallback = (action: string, extra: Record<string, string> = {}) =>
      this.buildCallbackBehaviors({
        action,
        chatId: data.chatId,
        messageId: data.messageId,
        stockCode: data.stockCode,
        stockName: data.stockName,
        viewpoint: data.viewpoint,
        operationTag: data.operationTag,
        eventTime: data.eventTime,
        ...extra
      })

    return {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '✏️ 编辑笔记' },
        template: 'blue'
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: [
              `**股票**：${data.stockName} (${data.stockCode})`,
              `**当前分类**：${data.category || '看盘预测'}`,
              `**说明**：请直接修改下方字段，点击对应按钮提交`
            ].join('\n'),
            text_align: 'left',
            text_size: 'normal'
          },
          {
            tag: 'form',
            name: `edit_form_${shortId}`,
            direction: 'vertical',
            horizontal_spacing: '8px',
            vertical_spacing: '12px',
            elements: [
              {
                tag: 'input',
                name: `stock_input_${shortId}`,
                label: { tag: 'plain_text', content: '股票名称/代码' },
                label_position: 'top',
                width: 'fill',
                required: true,
                default_value: `${data.stockName} (${data.stockCode})`,
                placeholder: { tag: 'plain_text', content: '请输入股票名称或 6 位代码' }
              },
              {
                tag: 'input',
                name: `content_input_${shortId}`,
                label: { tag: 'plain_text', content: '笔记正文' },
                label_position: 'top',
                width: 'fill',
                required: true,
                input_type: 'multiline_text',
                rows: 4,
                auto_resize: true,
                max_rows: 10,
                default_value: data.originalText,
                placeholder: { tag: 'plain_text', content: '请输入整理后的笔记正文' }
              },
              {
                tag: 'select_static',
                name: `category_select_${shortId}`,
                width: 'fill',
                required: true,
                placeholder: { tag: 'plain_text', content: '请选择笔记类型' },
                initial_option: data.category || '看盘预测',
                options: ['看盘预测', '普通笔记'].map((option) => ({
                  text: { tag: 'plain_text', content: option },
                  value: option
                }))
              },
              {
                tag: 'select_static',
                name: `viewpoint_select_${shortId}`,
                width: 'fill',
                placeholder: { tag: 'plain_text', content: '请选择观点' },
                initial_option: data.viewpoint || '未知',
                options: ['看多', '看空', '震荡', '未知'].map((option) => ({
                  text: { tag: 'plain_text', content: option },
                  value: option
                }))
              },
              {
                tag: 'select_static',
                name: `operation_select_${shortId}`,
                width: 'fill',
                placeholder: { tag: 'plain_text', content: '请选择操作标签' },
                initial_option: data.operationTag || '无',
                options: ['买入', '卖出', '无'].map((option) => ({
                  text: { tag: 'plain_text', content: option },
                  value: option
                }))
              },
              {
                tag: 'picker_datetime',
                name: `event_time_input_${shortId}`,
                width: 'fill',
                required: true,
                initial_datetime: data.eventTime,
                placeholder: { tag: 'plain_text', content: '请选择事件时间' }
              },
              {
                tag: 'markdown',
                content: '说明：选择“普通笔记”时，观点和操作标签仅作为补充信息，不参与严格校验。',
                text_align: 'left',
                text_size: 'normal'
              },
              {
                tag: 'column_set',
                flex_mode: 'flow',
                horizontal_spacing: '8px',
                columns: [
                  {
                    tag: 'column',
                    width: 'auto',
                    elements: [
                      {
                        tag: 'button',
                        name: `save_entry_${shortId}`,
                        form_action_type: 'submit',
                        type: 'primary_filled',
                        text: { tag: 'plain_text', content: '保存笔记' },
                        behaviors: buildCallback('save_edit')
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '取消' },
            type: 'default',
            behaviors: buildCallback('cancel')
          },
          {
            tag: 'markdown',
            content: `**原文参考**\n${data.originalText.slice(0, 300)}${data.originalText.length > 300 ? '...' : ''}`,
            text_align: 'left',
            text_size: 'normal'
          }
        ]
      }
    }
  }

  buildAskStockCard(data: AskStockCardData): object {
    const candidates = (data.candidates || []).slice(0, 3)
    const candidateSummary = candidates
      .map((candidate, index) => `${index + 1}. ${candidate.name} (${candidate.code}) ${(candidate.confidence * 100).toFixed(0)}%`)
      .join('\n')

    const candidateButtons = candidates.map((candidate) => ({
      tag: 'column',
      width: 'auto',
      elements: [
        this.buildButton({
          text: `${candidate.name} (${candidate.code})`,
          payload: {
            action: 'provide_stock',
            chatId: data.chatId,
            messageId: data.messageId,
            stockCode: candidate.code,
            stockName: candidate.name
          }
        })
      ]
    }))

    return {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🔍 需要补充股票信息' },
        template: 'orange'
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: data.message,
            text_align: 'left',
            text_size: 'normal'
          },
          {
            tag: 'markdown',
            content: `**原文**\n${data.originalText.slice(0, 200)}${data.originalText.length > 200 ? '...' : ''}`,
            text_align: 'left',
            text_size: 'normal'
          },
          ...(candidateSummary ? [{
            tag: 'markdown',
            content: `**候选股票（点击直接选择）**\n${candidateSummary}`,
            text_align: 'left',
            text_size: 'normal'
          }] : []),
          ...(candidateButtons.length > 0 ? [{
            tag: 'column_set',
            flex_mode: 'flow',
            horizontal_spacing: '8px',
            columns: candidateButtons
          }] : []),
          {
            tag: 'markdown',
            content: '请直接回复股票名称或代码，例如：贵州茅台 或 600519',
            text_align: 'left',
            text_size: 'normal'
          }
        ]
      }
    }
  }

  buildSuccessCard(stockName: string, stockCode: string): object {
    return {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '✅ 笔记已保存' },
        template: 'green'
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: `已保存到 **${stockName} (${stockCode})** 的笔记中`,
            text_align: 'left',
            text_size: 'normal'
          }
        ]
      }
    }
  }

  buildErrorCard(errorMessage: string): object {
    return {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '❌ 保存失败' },
        template: 'red'
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: errorMessage,
            text_align: 'left',
            text_size: 'normal'
          }
        ]
      }
    }
  }
}

export const cardBuilder = new CardBuilder()
