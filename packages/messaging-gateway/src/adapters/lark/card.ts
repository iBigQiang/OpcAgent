import type { InlineButton } from '../../types'

export const LARK_MAX_BUTTONS = 10
export const LARK_MAX_LABEL_LENGTH = 30

export interface LarkCardSchema {
  schema: '2.0'
  config: { wide_screen_mode: boolean }
  body: { elements: Array<Record<string, unknown>> }
}

export function buildLarkCard(text: string, buttons: InlineButton[], messageId = ''): LarkCardSchema {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [
        { tag: 'div', text: { tag: 'plain_text', content: text } },
        ...buttons.slice(0, LARK_MAX_BUTTONS).map((button, index) => ({
          tag: 'button',
          text: { tag: 'plain_text', content: truncate(button.label) },
          type: index === 0 ? 'primary' : 'default',
          behaviors: [{
            type: 'callback',
            value: {
              buttonId: button.id,
              messageId,
              ...(button.data === undefined ? {} : { data: button.data }),
            },
          }],
        })),
      ],
    },
  }
}

export function buildClearedCard(text: string): LarkCardSchema {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: { elements: [{ tag: 'div', text: { tag: 'plain_text', content: text } }] },
  }
}

export function isLarkEditExpiredError(error: unknown): boolean {
  const value = error as { code?: unknown; response?: { code?: unknown; data?: { code?: unknown } } }
  const code = value?.code ?? value?.response?.code ?? value?.response?.data?.code
  return code === 230003 || code === 234001 || code === 230001 || code === 230002
}

function truncate(value: string): string {
  return value.length <= LARK_MAX_LABEL_LENGTH ? value : `${value.slice(0, LARK_MAX_LABEL_LENGTH - 1)}...`
}
