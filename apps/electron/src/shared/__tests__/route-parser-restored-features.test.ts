import { describe, expect, test } from 'bun:test'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('restored feature routes', () => {
  test('round-trips project list and detail routes', () => {
    expect(parseCompoundRoute('projects')).toEqual({ navigator: 'projects', details: null })
    const detail = parseCompoundRoute('projects/project/project-one')
    expect(detail).toEqual({ navigator: 'projects', details: { type: 'project', id: 'project-one' } })
    expect(buildCompoundRoute(detail!)).toBe('projects/project/project-one')
    expect(buildRouteFromNavigationState({ navigator: 'projects', details: { type: 'project', projectSlug: 'project-one' } })).toBe('projects/project/project-one')
  })

  test('round-trips label filters without losing encoded identifiers', () => {
    const state = parseRouteToNavigationState('label/team%2Fresearch')
    expect(state).toEqual({ navigator: 'sessions', filter: { kind: 'label', labelId: 'team/research' }, details: null })
    expect(buildRouteFromNavigationState(state!)).toBe('label/team%2Fresearch')
  })

  test('accepts labels and messaging settings and rejects trailing segments', () => {
    expect(parseRouteToNavigationState('settings/labels')).toEqual({ navigator: 'settings', subpage: 'labels' })
    expect(parseRouteToNavigationState('settings/messaging')).toEqual({ navigator: 'settings', subpage: 'messaging' })
    expect(parseCompoundRoute('settings/messaging/extra')).toBeNull()
  })
})
