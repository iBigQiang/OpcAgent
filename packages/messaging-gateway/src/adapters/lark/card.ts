export interface LarkInlineButton { id: string; label: string; data?: string }
export interface LarkCardSchema { schema: '2.0'; body: { elements: Array<Record<string, unknown>> } }
export const LARK_MAX_BUTTONS = 10
export function buildLarkCard(text: string, buttons: LarkInlineButton[]): LarkCardSchema { return { schema: '2.0', body: { elements: [{ tag: 'markdown', content: text }, ...buttons.slice(0, LARK_MAX_BUTTONS).map(button => ({ tag: 'button', text: { tag: 'plain_text', content: button.label.slice(0, 30) }, value: { id: button.id, data: button.data } }))] } } }
export function buildClearedCard(text: string): LarkCardSchema { return buildLarkCard(text, []) }
export function isLarkEditExpiredError(error: unknown): boolean { const code = (error as { response?: { data?: { code?: number } } })?.response?.data?.code; return code === 230001 || code === 230002 }
