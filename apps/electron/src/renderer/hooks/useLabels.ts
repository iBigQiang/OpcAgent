/**
 * useLabels Hook
 *
 * React hook to load and manage workspace labels.
 * Returns the label tree (nested structure with children) from config.
 * Also exposes a flattened version for components that need flat lookups.
 * Auto-refreshes when workspace changes or label config changes.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { CreateLabelInput, LabelConfig, UpdateLabelInput } from '@mkagent/shared/labels'
import { flattenLabels } from '@mkagent/shared/labels'

export interface UseLabelsResult {
  /** Label tree (root-level nodes with nested children) */
  labels: LabelConfig[]
  /** Flattened label list for lookups and non-hierarchical display */
  flatLabels: LabelConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (input: CreateLabelInput) => Promise<LabelConfig>
  update: (labelId: string, updates: UpdateLabelInput) => Promise<LabelConfig>
  remove: (labelId: string) => Promise<{ stripped: number }>
  move: (labelId: string, parentId: string | null) => Promise<void>
  reorder: (parentId: string | null, orderedIds: string[]) => Promise<void>
}

/**
 * Load labels for a workspace via IPC.
 * Returns the tree structure (labels with nested children).
 * Auto-refreshes when workspaceId changes.
 * Subscribes to live label config changes via LABELS_CHANGED event.
 */
export function useLabels(workspaceId: string | null): UseLabelsResult {
  const [labels, setLabels] = useState<LabelConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Memoized flat version of the tree for lookups
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLabels([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await window.electronAPI.listLabels(workspaceId)
      setLabels(configs)
      setError(null)
    } catch (err) {
      console.error('[useLabels] Failed to load labels:', err)
      setError(err instanceof Error ? err.message : 'Failed to load labels')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  const withWorkspace = useCallback(async <T,>(operation: (id: string) => Promise<T>): Promise<T> => {
    if (!workspaceId) throw new Error('Select a workspace first')
    const result = await operation(workspaceId)
    await refresh()
    return result
  }, [workspaceId, refresh])

  const create = useCallback((input: CreateLabelInput) => withWorkspace(id => window.electronAPI.createLabel(id, input)), [withWorkspace])
  const update = useCallback((labelId: string, updates: UpdateLabelInput) => withWorkspace(id => window.electronAPI.updateLabel(id, labelId, updates)), [withWorkspace])
  const remove = useCallback((labelId: string) => withWorkspace(id => window.electronAPI.deleteLabel(id, labelId)), [withWorkspace])
  const move = useCallback((labelId: string, parentId: string | null) => withWorkspace(id => window.electronAPI.moveLabel(id, labelId, parentId)), [withWorkspace])
  const reorder = useCallback((parentId: string | null, orderedIds: string[]) => withWorkspace(id => window.electronAPI.reorderLabels(id, parentId, orderedIds)), [withWorkspace])

  // Load labels when workspace changes
  useEffect(() => {
    refresh()
  }, [refresh])

  // Subscribe to live label changes (config file changes)
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onLabelsChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace
      if (changedWorkspaceId === workspaceId) {
        refresh()
      }
    })

    return cleanup
  }, [workspaceId, refresh])

  return {
    labels,
    flatLabels,
    isLoading,
    error,
    refresh,
    create,
    update,
    remove,
    move,
    reorder,
  }
}
