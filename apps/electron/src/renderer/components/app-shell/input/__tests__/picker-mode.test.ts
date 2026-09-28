import { describe, test, expect } from 'bun:test'
import { derivePickerMode } from '../picker-mode'

describe('会话渠道选择器显示模式', () => {
  test('无其他渠道时，已删除渠道显示恢复说明', () => {
    expect(derivePickerMode({ connectionUnavailable: true, connectionDefaultModel: null, connectionCount: 0 })).toBe('unavailable')
  })

  test('删除原渠道后，即使只有一个存活渠道也能打开列表恢复', () => {
    expect(derivePickerMode({ connectionUnavailable: true, connectionDefaultModel: null, connectionCount: 1 })).toBe('switcher')
  })

  test('多个渠道优先显示渠道列表，不受当前只有一个模型限制', () => {
    expect(derivePickerMode({ connectionUnavailable: false, connectionDefaultModel: 'mistral', connectionCount: 2 })).toBe('switcher')
    expect(derivePickerMode({ connectionUnavailable: false, connectionDefaultModel: null, connectionCount: 3 })).toBe('switcher')
  })

  test('一个单模型渠道保留只读模型行', () => {
    expect(derivePickerMode({ connectionUnavailable: false, connectionDefaultModel: 'mistral', connectionCount: 1 })).toBe('locked-single')
  })

  test('一个多模型渠道直接列出模型', () => {
    expect(derivePickerMode({ connectionUnavailable: false, connectionDefaultModel: null, connectionCount: 1 })).toBe('flat')
  })

  test('尚未加载渠道时不崩溃', () => {
    expect(derivePickerMode({ connectionUnavailable: false, connectionDefaultModel: null, connectionCount: 0 })).toBe('flat')
  })
})
