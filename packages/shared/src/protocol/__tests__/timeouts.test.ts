import { describe, expect, it } from 'bun:test'
import {
  CONNECTION_SETUP_REQUEST_TIMEOUT_MS,
  getRpcRequestTimeoutMs,
  REQUEST_TIMEOUT_MS,
} from '../types.ts'

describe('getRpcRequestTimeoutMs', () => {
  it('allows a real provider CLI to finish connection setup', () => {
    expect(getRpcRequestTimeoutMs('settings:testLlmConnectionSetup'))
      .toBe(CONNECTION_SETUP_REQUEST_TIMEOUT_MS)
  })

  it('keeps the standard timeout for unrelated channels', () => {
    expect(getRpcRequestTimeoutMs('settings:getServerStatus')).toBe(REQUEST_TIMEOUT_MS)
    expect(getRpcRequestTimeoutMs('other', 12_345)).toBe(12_345)
  })
})
