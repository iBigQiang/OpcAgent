import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLabel, deleteLabel, moveLabel, reorderLabels, updateLabel } from '../crud'
import { evaluateAutoLabels } from '../auto/evaluator'
import { matchesLabelFilter } from '../filter'
import { resolveSessionLabels } from '../resolve'
import { initializeLabelConfig, migrateLabelConfig, saveLabelConfig, loadLabelConfig } from '../storage'
import { flattenLabels, sortLabelsForDisplay } from '../tree'
import { extractLabelId, toggleLabelInList, validateLabelValue } from '../values'

const roots: string[] = []
function temporaryWorkspace(prefix = 'opcagent-labels-'): string { const root = mkdtempSync(join(tmpdir(), prefix)); roots.push(root); return root }
function workspace(): string { const root = temporaryWorkspace(); saveLabelConfig(root, { version: 1, labels: [] }); return root }
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

describe('labels data contract', () => {
  test('CRUD keeps hierarchy and deleting a parent removes descendants from config', async () => {
    const root = workspace(); const parent = createLabel(root, { name: 'Area', color: 'accent' }); const child = createLabel(root, { name: 'UI', parentId: parent.id, color: 'info' })
    expect(flattenLabels(loadLabelConfig(root).labels).map(label => label.id)).toEqual([parent.id, child.id])
    expect((await deleteLabel(root, parent.id)).stripped).toBe(0)
    expect(flattenLabels(loadLabelConfig(root).labels)).toEqual([])
  })
  test('filter/value resolution preserves id::value semantics and parent matching', () => {
    const tree = [{ id: 'priority', name: 'Priority', valueType: 'number' as const, children: [{ id: 'priority-high', name: 'High' }] }]
    expect(extractLabelId('priority::3')).toBe('priority')
    expect(toggleLabelInList(['priority::3', 'bug'], 'priority')).toEqual(['bug'])
    expect(validateLabelValue('3e5', 'number')).toBe(false)
    expect(matchesLabelFilter({ labels: ['priority-high'] }, { labelId: 'priority' }, tree)).toBe(true)
    expect(resolveSessionLabels(['priority::3'], tree).resolved).toEqual(['priority::3'])
  })
  test('update, move, and reorder preserve a valid label tree', () => {
    const root = workspace()
    const first = createLabel(root, { name: 'First' })
    const second = createLabel(root, { name: 'Second' })
    const child = createLabel(root, { name: 'Child', parentId: first.id })
    expect(updateLabel(root, first.id, { name: 'Renamed' }).name).toBe('Renamed')
    moveLabel(root, child.id, null)
    reorderLabels(root, null, [second.id, child.id, first.id])
    expect(loadLabelConfig(root).labels.map(label => label.id)).toEqual([second.id, child.id, first.id])
    expect(() => reorderLabels(root, null, [first.id])).toThrow('each sibling exactly once')
    expect(() => moveLabel(root, first.id, first.id)).toThrow('into itself')
  })
  test('tree display sorts without mutating and auto rules ignore code blocks', () => {
    const labels = [{ id: 'z', name: 'Zulu' }, { id: 'a', name: 'Alpha', valueType: 'number' as const, autoRules: [{ pattern: 'BUG-(\\d+)', valueTemplate: '$1' }] }]
    expect(sortLabelsForDisplay(labels).map(label => label.name)).toEqual(['Alpha', 'Zulu'])
    expect(labels.map(label => label.name)).toEqual(['Zulu', 'Alpha'])
    expect(evaluateAutoLabels('BUG-42 `BUG-99`', labels)).toEqual([{ labelId: 'a', value: '42', matchedText: 'BUG-42' }])
    expect(evaluateAutoLabels('BUG-high', labels)).toEqual([])
  })
  test('read-only access neither initializes nor migrates label config', () => {
    const root = temporaryWorkspace('opcagent-labels-read-')
    const path = join(root, 'labels', 'config.json')
    expect(loadLabelConfig(root).labels).toHaveLength(4)
    expect(existsSync(path)).toBe(false)
    initializeLabelConfig(root)
    writeFileSync(path, JSON.stringify({ version: 1, labels: [{ id: 'old', name: 'Old', color: 'text-accent' }] }))
    expect(loadLabelConfig(root).labels[0]?.color as unknown).toBe('text-accent')
    expect(JSON.parse(readFileSync(path, 'utf8')).labels[0].color).toBe('text-accent')
    expect(migrateLabelConfig(root).labels[0]?.color).toBe('accent')
  })
  test('malformed label config fails closed and cannot be overwritten by a read', () => {
    const root = temporaryWorkspace('opcagent-labels-invalid-')
    const path = join(root, 'labels', 'config.json')
    mkdirSync(join(root, 'labels'), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 1, labels: [{ id: 'bad', name: '' }] }))
    expect(loadLabelConfig(root)).toEqual({ version: 1, labels: [] })
    expect(JSON.parse(readFileSync(path, 'utf8')).labels[0].name).toBe('')
  })
})
