import { expect, test } from 'bun:test'
import { processUpsert } from './upsert'

test('upsert drops own and empty messages', () => {
  expect(processUpsert([{ key: { remoteJid: 'a@s.whatsapp.net', id: '1', fromMe: true }, message: { conversation: 'x' } }])).toEqual([])
  const event = processUpsert([{ key: { remoteJid: 'a@s.whatsapp.net', id: '2' }, message: { conversation: 'ok' } }])[0]
  expect(event?.type).toBe('incoming')
  if (event?.type === 'incoming') expect(event.text).toBe('ok')
})
