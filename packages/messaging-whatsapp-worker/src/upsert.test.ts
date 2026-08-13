import { expect, test } from 'bun:test'
import { processUpsert } from './upsert'

test('upsert drops own and empty messages', () => {
  expect(processUpsert([{ key: { remoteJid: 'a@s.whatsapp.net', id: '1', fromMe: true }, message: { conversation: 'x' } }])).toEqual([])
  const event = processUpsert([{ key: { remoteJid: 'a@s.whatsapp.net', id: '2' }, message: { conversation: 'ok' } }])[0]
  expect(event?.type).toBe('incoming')
  if (event?.type === 'incoming') expect(event.text).toBe('ok')
})

test('upsert rejects groups by default and uses the participant as group sender', () => {
  const group = { key: { remoteJid: 'group@g.us', participant: 'member@s.whatsapp.net', id: '3' }, message: { conversation: 'hello' } }
  expect(processUpsert([group])).toEqual([])
  const event = processUpsert([group], undefined, ['group@g.us'])[0]
  expect(event).toMatchObject({ type: 'incoming', channelId: 'group@g.us', chatType: 'group', senderId: 'member@s.whatsapp.net' })
})

test('upsert keeps media-only messages for worker download', () => {
  const event = processUpsert([{ key: { remoteJid: 'a@s.whatsapp.net', id: '4' }, message: { imageMessage: { mimetype: 'image/jpeg' } } }])[0]
  expect(event).toMatchObject({ type: 'incoming', chatType: 'private', text: '' })
})
