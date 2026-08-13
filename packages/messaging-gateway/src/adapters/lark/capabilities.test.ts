import { expect, test } from 'bun:test'
import { LarkAdapter } from './index'

test('lark advertises rich rendering capabilities without initializing a provider', () => {
  expect(new LarkAdapter().capabilities).toMatchObject({ messageEditing: true, inlineButtons: true, maxButtons: 10 })
})
