import { describe, expect, test } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute } from '../route-parser'

describe('automation routes', () => {
  test('parses and roundtrips scheduled automation details', () => {
    const parsed = parseCompoundRoute('automations/scheduled/automation/a-1')
    expect(parsed).toMatchObject({ navigator: 'automations', automationFilter: { kind: 'type', automationType: 'scheduled' }, details: { type: 'automation', id: 'a-1' } })
    expect(buildCompoundRoute(parsed!)).toBe('automations/scheduled/automation/a-1')
  })

  test.each([
    ['scheduled', 'scheduled'],
    ['event', 'event'],
    ['agentic', 'agentic'],
  ] as const)('roundtrips the %s automation submenu', (segment, automationType) => {
    const route = `automations/${segment}`
    const parsed = parseCompoundRoute(route)
    expect(parsed).toEqual({
      navigator: 'automations',
      automationFilter: { kind: 'type', automationType },
      details: null,
    })
    expect(buildCompoundRoute(parsed!)).toBe(route)
  })

  test('roundtrips the unfiltered automations parent route', () => {
    const parsed = parseCompoundRoute('automations')
    expect(parsed).toEqual({ navigator: 'automations', automationFilter: undefined, details: null })
    expect(buildCompoundRoute(parsed!)).toBe('automations')
  })

  test('rejects invalid automation paths', () => { expect(parseCompoundRoute('automations/unknown')).toBeNull() })
})
