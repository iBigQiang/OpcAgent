import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSessionPlan } from '../registry'
import type { MessagingSessionManager } from '../session-manager'

test('plan loading is confined to the session plans directory and size limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'messaging-plan-'))
  const sessionPath = join(root, 'session')
  const plansPath = join(sessionPath, 'plans')
  mkdirSync(plansPath, { recursive: true })
  const valid = join(plansPath, 'valid.md')
  const outside = join(root, 'outside.md')
  const oversized = join(plansPath, 'oversized.md')
  writeFileSync(valid, 'approved plan', 'utf8')
  writeFileSync(outside, 'private file', 'utf8')
  writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1))
  const manager = { getSessionPath: () => sessionPath } as unknown as MessagingSessionManager
  expect(loadSessionPlan(manager, 'session-one', valid)).toBe('approved plan')
  expect(loadSessionPlan(manager, 'session-one', outside)).toBeNull()
  expect(loadSessionPlan(manager, 'session-one', oversized)).toBeNull()
})
