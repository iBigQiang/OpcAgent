import { describe, expect, test } from 'bun:test'
import type { LabelConfig } from '@opcagent/shared/labels'
import { createLabelMenuItems, filterItems, filterSessionStatuses } from '../label-menu-utils'

describe('label menu', () => {
  test('sorts nested labels, retains breadcrumbs and excludes applied entries', () => {
    const labels: LabelConfig[] = [{ id: 'priority', name: 'Priority', children: [{ id: 'high', name: 'High' }] }, { id: 'bug', name: 'Bug' }]
    const items = createLabelMenuItems(labels, ['bug'])
    expect(items.map(item => item.label)).toEqual(['High', 'Priority'])
    expect(items.find(item => item.id === 'high')?.parentPath).toBe('Priority / ')
    expect(filterItems(items, 'priority/high').map(item => item.id)).toEqual(['high'])
  })

  test('filters session status choices without treating nested label syntax as a match', () => {
    const states = [
      { id: 'open', label: 'Open' },
      { id: 'in-progress', label: 'In progress' },
      { id: 'closed', label: 'Closed' },
    ]
    expect(filterSessionStatuses(states, 'pro').map(state => state.id)).toEqual(['in-progress'])
    expect(filterSessionStatuses(states, 'open/closed')).toEqual([])
  })
})
