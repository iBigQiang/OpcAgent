import { describe, expect, test } from 'bun:test'
import { migrateColorValue } from './migrate'
import { resolveEntityColor } from './resolve'
import { isValidCSSColor, isValidEntityColor, isValidSystemColor } from './validate'

describe('entity colors', () => {
  test('accepts the documented color forms and rejects malformed values', () => {
    expect(isValidSystemColor('accent')).toBe(true)
    expect(isValidSystemColor('foreground/100')).toBe(true)
    expect(isValidSystemColor('foreground/101')).toBe(false)
    expect(isValidCSSColor('#aBc')).toBe(true)
    expect(isValidCSSColor('rgb(1, 2, 3)')).toBe(true)
    expect(isValidCSSColor('not-a-color')).toBe(false)
    expect(isValidEntityColor({ light: '#123456', dark: '#abcdef' })).toBe(true)
    expect(isValidEntityColor({ light: 'red' })).toBe(false)
  })

  test('migrates legacy values and resolves safe CSS output', () => {
    expect(migrateColorValue('text-accent')).toEqual({ migrated: 'accent', changed: true })
    expect(migrateColorValue('#123456')).toEqual({ migrated: { light: '#123456' }, changed: true })
    expect(resolveEntityColor('foreground/50', false)).toBe('color-mix(in oklch, var(--foreground) 50%, transparent)')
    expect(resolveEntityColor({ light: '#111', dark: '#eee' }, true)).toBe('#eee')
  })
})
