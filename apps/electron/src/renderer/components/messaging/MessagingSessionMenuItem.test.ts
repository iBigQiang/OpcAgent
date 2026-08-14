import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('session pairing checks the dedicated messaging runtime API', () => {
  const source = readFileSync(new URL('./MessagingSessionMenuItem.tsx', import.meta.url), 'utf8')

  expect(source).toContain('window.electronAPI.getMessagingRuntime()')
  expect(source).not.toContain('window.electronAPI.getMessagingConfig())?.runtime')
})
