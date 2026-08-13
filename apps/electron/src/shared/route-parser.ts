/**
 * Route parsing for the retained MkAgent surface.
 *
 * This is the Craft navigation contract with excluded navigators removed:
 * sessions, Skills, and settings still share the same URL-driven panel model.
 */

import type { AutomationFilter, NavigationState, SessionFilter, SourceFilter, RightSidebarPanel } from './types'
import { isValidSettingsSubpage } from './settings-registry'

export type RouteType = 'action' | 'view'

export interface ParsedRoute {
  type: RouteType
  name: string
  id?: string
  params: Record<string, string>
}

export type NavigatorType = 'sessions' | 'sources' | 'skills' | 'automations' | 'projects' | 'settings'

export interface ParsedCompoundRoute {
  navigator: NavigatorType
  sessionFilter?: SessionFilter
  sourceFilter?: SourceFilter
  automationFilter?: AutomationFilter
  details: { type: string; id: string } | null
}

const COMPOUND_ROUTE_PREFIXES = ['allSessions', 'flagged', 'archived', 'label', 'sources', 'skills', 'automations', 'projects', 'settings']

export function isCompoundRoute(route: string): boolean {
  const firstSegment = route.split('?')[0].split('/')[0]
  return COMPOUND_ROUTE_PREFIXES.includes(firstSegment)
}

export function parseCompoundRoute(route: string): ParsedCompoundRoute | null {
  const segments = route.split('?')[0].split('/').filter(Boolean)
  if (segments.length === 0) return null
  const first = segments[0]

  if (first === 'sources') {
    if (segments.length === 1) return { navigator: 'sources', details: null }
    const sourceTypes = new Set(['api', 'mcp', 'local'])
    let index = 1
    let sourceFilter: SourceFilter | undefined
    if (sourceTypes.has(segments[index] ?? '')) {
      sourceFilter = { kind: 'type', sourceType: segments[index] as SourceFilter['sourceType'] }
      index += 1
    }
    if (index === segments.length) return { navigator: 'sources', sourceFilter, details: null }
    if (segments[index] === 'source' && segments[index + 1] && index + 2 === segments.length) {
      return {
        navigator: 'sources',
        sourceFilter,
        details: { type: 'source', id: segments[index + 1] },
      }
    }
    return null
  }

  if (first === 'settings') {
    const subpage = segments[1]
    if (subpage === undefined) return { navigator: 'settings', details: null }
    if (!isValidSettingsSubpage(subpage) || segments.length > 2) return null
    return { navigator: 'settings', details: { type: subpage, id: subpage } }
  }

  if (first === 'skills') {
    if (segments.length === 1) return { navigator: 'skills', details: null }
    if (segments[1] === 'skill' && segments[2] && segments.length === 3) {
      return { navigator: 'skills', details: { type: 'skill', id: segments[2] } }
    }
    return null
  }

  if (first === 'projects') {
    if (segments.length === 1) return { navigator: 'projects', details: null }
    if (segments[1] === 'project' && segments[2] && segments.length === 3) {
      return { navigator: 'projects', details: { type: 'project', id: segments[2] } }
    }
    return null
  }

  if (first === 'automations') {
    const type = segments[1] === 'scheduled' || segments[1] === 'event' || segments[1] === 'agentic'
      ? segments[1] as AutomationFilter['automationType']
      : undefined
    const offset = type ? 2 : 1
    const automationFilter = type ? { kind: 'type' as const, automationType: type } : undefined
    if (segments.length === offset) return { navigator: 'automations', automationFilter, details: null }
    if (segments[offset] === 'automation' && segments[offset + 1] && segments.length === offset + 2) {
      return { navigator: 'automations', automationFilter, details: { type: 'automation', id: segments[offset + 1] } }
    }
    return null
  }

  const filter: SessionFilter | null =
    first === 'allSessions' ? { kind: 'allSessions' }
      : first === 'flagged' ? { kind: 'flagged' }
        : first === 'archived' ? { kind: 'archived' }
          : first === 'label' && segments[1] ? { kind: 'label', labelId: decodeURIComponent(segments[1]) }
          : null
  if (!filter) return null
  const filterOffset = filter.kind === 'label' ? 2 : 1
  if (segments.length === filterOffset) {
    return { navigator: 'sessions', sessionFilter: filter, details: null }
  }
  if (segments[filterOffset] === 'session' && segments[filterOffset + 1] && segments.length === filterOffset + 2) {
    return {
      navigator: 'sessions',
      sessionFilter: filter,
      details: { type: 'session', id: segments[filterOffset + 1] },
    }
  }
  return null
}

export function buildCompoundRoute(parsed: ParsedCompoundRoute): string {
  if (parsed.navigator === 'sources') {
    const base = parsed.sourceFilter ? `sources/${parsed.sourceFilter.sourceType}` : 'sources'
    return parsed.details ? `${base}/source/${parsed.details.id}` : base
  }
  if (parsed.navigator === 'settings') {
    return parsed.details ? `settings/${parsed.details.id}` : 'settings'
  }
  if (parsed.navigator === 'skills') {
    return parsed.details ? `skills/skill/${parsed.details.id}` : 'skills'
  }
  if (parsed.navigator === 'projects') {
    return parsed.details ? `projects/project/${parsed.details.id}` : 'projects'
  }
  if (parsed.navigator === 'automations') {
    const base = parsed.automationFilter ? `automations/${parsed.automationFilter.automationType}` : 'automations'
    return parsed.details ? `${base}/automation/${parsed.details.id}` : base
  }
  const base = parsed.sessionFilter?.kind === 'label'
    ? `label/${encodeURIComponent(parsed.sessionFilter.labelId)}`
    : parsed.sessionFilter?.kind ?? 'allSessions'
  return parsed.details ? `${base}/session/${parsed.details.id}` : base
}

function compoundToParsedRoute(compound: ParsedCompoundRoute): ParsedRoute {
  if (compound.navigator === 'sources') {
    return compound.details
      ? { type: 'view', name: 'source-info', id: compound.details.id, params: {} }
      : { type: 'view', name: 'sources', params: {} }
  }
  if (compound.navigator === 'settings') {
    return compound.details
      ? { type: 'view', name: compound.details.id, params: {} }
      : { type: 'view', name: 'settings', params: {} }
  }
  if (compound.navigator === 'skills') {
    return compound.details
      ? { type: 'view', name: 'skill-info', id: compound.details.id, params: {} }
      : { type: 'view', name: 'skills', params: {} }
  }
  if (compound.navigator === 'projects') {
    return compound.details ? { type: 'view', name: 'project-info', id: compound.details.id, params: {} } : { type: 'view', name: 'projects', params: {} }
  }
  if (compound.navigator === 'automations') {
    return compound.details ? { type: 'view', name: 'automation-info', id: compound.details.id, params: {} } : { type: 'view', name: 'automations', params: {} }
  }
  const filter = compound.sessionFilter ?? { kind: 'allSessions' as const }
  return compound.details
    ? { type: 'view', name: 'session', id: compound.details.id, params: { filter: filter.kind } }
    : { type: 'view', name: filter.kind, params: {} }
}

export function parseRoute(route: string): ParsedRoute | null {
  try {
    if (isCompoundRoute(route)) {
      const compound = parseCompoundRoute(route)
      return compound ? compoundToParsedRoute(compound) : null
    }

    const [pathPart, queryPart] = route.split('?')
    const segments = pathPart.split('/').filter(Boolean)
    if (segments.length < 2 || segments[0] !== 'action') return null
    const params: Record<string, string> = {}
    if (queryPart) {
      new URLSearchParams(queryPart).forEach((value, key) => { params[key] = value })
    }
    return { type: 'action', name: segments[1], id: segments[2], params }
  } catch {
    return null
  }
}

function compoundToNavigationState(compound: ParsedCompoundRoute): NavigationState {
  if (compound.navigator === 'sources') {
    return {
      navigator: 'sources',
      filter: compound.sourceFilter,
      details: compound.details ? { type: 'source', sourceSlug: compound.details.id } : null,
    }
  }
  if (compound.navigator === 'settings') {
    return {
      navigator: 'settings',
      subpage: compound.details && isValidSettingsSubpage(compound.details.id)
        ? compound.details.id
        : null,
    }
  }
  if (compound.navigator === 'skills') {
    return {
      navigator: 'skills',
      details: compound.details ? { type: 'skill', skillSlug: compound.details.id } : null,
    }
  }
  if (compound.navigator === 'projects') {
    return { navigator: 'projects', details: compound.details ? { type: 'project', projectSlug: compound.details.id } : null }
  }
  if (compound.navigator === 'automations') {
    return { navigator: 'automations', filter: compound.automationFilter, details: compound.details ? { type: 'automation', automationId: compound.details.id } : null }
  }
  return {
    navigator: 'sessions',
    filter: compound.sessionFilter ?? { kind: 'allSessions' },
    details: compound.details ? { type: 'session', sessionId: compound.details.id } : null,
  }
}

export function parseRouteToNavigationState(route: string, sidebarParam?: string): NavigationState | null {
  if (!isCompoundRoute(route)) return null
  const compound = parseCompoundRoute(route)
  if (!compound) return null
  const state = compoundToNavigationState(compound)
  const rightSidebar = parseRightSidebarParam(sidebarParam)
  return rightSidebar ? { ...state, rightSidebar } : state
}

export function buildRouteFromNavigationState(state: NavigationState): string {
  if (state.navigator === 'sources') {
    const base = state.filter ? `sources/${state.filter.sourceType}` : 'sources'
    return state.details ? `${base}/source/${state.details.sourceSlug}` : base
  }
  if (state.navigator === 'settings') {
    return state.subpage ? `settings/${state.subpage}` : 'settings'
  }
  if (state.navigator === 'skills') {
    return state.details ? `skills/skill/${state.details.skillSlug}` : 'skills'
  }
  if (state.navigator === 'projects') {
    return state.details ? `projects/project/${state.details.projectSlug}` : 'projects'
  }
  if (state.navigator === 'automations') {
    const base = state.filter ? `automations/${state.filter.automationType}` : 'automations'
    return state.details ? `${base}/automation/${state.details.automationId}` : base
  }
  const base = state.filter.kind === 'label'
    ? `label/${encodeURIComponent(state.filter.labelId)}`
    : state.filter.kind
  return state.details ? `${base}/session/${state.details.sessionId}` : base
}

export function parseRightSidebarParam(sidebarStr?: string): RightSidebarPanel | undefined {
  if (!sidebarStr) return undefined
  if (sidebarStr === 'history') return { type: 'history' }
  if (sidebarStr === 'files') return { type: 'files' }
  if (sidebarStr.startsWith('files/')) return { type: 'files', path: sidebarStr.slice(6) || undefined }
  if (sidebarStr === 'none') return { type: 'none' }
  return undefined
}

export function buildRightSidebarParam(panel?: RightSidebarPanel): string | undefined {
  if (!panel || panel.type === 'none') return undefined
  if (panel.type === 'history') return 'history'
  return panel.path ? `files/${panel.path}` : 'files'
}
