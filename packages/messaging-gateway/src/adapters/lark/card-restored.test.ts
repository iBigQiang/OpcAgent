import { expect, test } from 'bun:test'
import { buildLarkCard, LARK_MAX_BUTTONS } from './card'

test('Lark cards use schema 2 callback behaviors and cap buttons', () => {
  const card = buildLarkCard('Review', Array.from({ length: LARK_MAX_BUTTONS + 2 }, (_, index) => ({ id: `button-${index}`, label: `Button ${index}` })), 'message-one')
  expect(card.schema).toBe('2.0')
  expect(card.config.wide_screen_mode).toBe(true)
  expect(card.body.elements).toHaveLength(LARK_MAX_BUTTONS + 1)
  expect(card.body.elements[1]).toMatchObject({
    tag: 'button',
    behaviors: [{ type: 'callback', value: { buttonId: 'button-0', messageId: 'message-one' } }],
  })
})
