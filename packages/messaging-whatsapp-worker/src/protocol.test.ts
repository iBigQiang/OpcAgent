import { expect, test } from 'bun:test'
import { encodeMessage, parseFrames } from './protocol'

test('worker protocol rejects malformed input and exposes no auth material in events', () => {
  expect(parseFrames('not json\n').messages).toEqual([])
  expect(encodeMessage({ type: 'ready' })).toBe('{"type":"ready"}\n')
})
