/**
 * SendResourceToWorkspaceDialog — Copy a source or skill to another workspace.
 *
 * Uses the resources:export → resources:import RPC pipeline.
 * MkAgent's retained workspace model is local, so both RPC calls use the same server.
 *
 * Adapted from SendToWorkspaceDialog (session transfer).
 */

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { cn } from '@/lib/utils'
import type { Workspace, ExportResourcesOptions, ResourceImportMode } from '../../../shared/types'

export type SendResourceType = 'source' | 'skill' | 'automation'

export interface SendResourceToWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What kind of resource to send */
  resourceType: SendResourceType
  /** Slug(s) or ID(s) of resources to send */
  resourceIds: string[]
  /** Display label for the dialog description (e.g., "Slack source") */
  resourceLabel: string
  /** All workspaces */
  workspaces: Workspace[]
  /** Current workspace ID (excluded from picker) */
  activeWorkspaceId: string | null
  /** Called after successful transfer */
  onTransferComplete?: () => void
}

const RESOURCE_TYPE_LABELS: Record<SendResourceType, { singular: string; plural: string }> = {
  source: { singular: 'source', plural: 'sources' },
  skill: { singular: 'skill', plural: 'skills' },
  automation: { singular: 'automation', plural: 'automations' },
}

export function SendResourceToWorkspaceDialog({
  open,
  onOpenChange,
  resourceType,
  resourceIds,
  resourceLabel,
  workspaces,
  activeWorkspaceId,
  onTransferComplete,
}: SendResourceToWorkspaceDialogProps) {
  const { t } = useTranslation()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  // All local workspaces except current
  const targetWorkspaces = workspaces.filter(w => w.id !== activeWorkspaceId)

  const handleSend = useCallback(async () => {
    if (!selectedWorkspaceId || !activeWorkspaceId || resourceIds.length === 0) return

    const targetWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!targetWorkspace) return

    setIsSending(true)
    const targetName = targetWorkspace.name
    const { singular, plural } = RESOURCE_TYPE_LABELS[resourceType]
    const count = resourceIds.length
    const label = count === 1 ? singular : plural
    const mode: ResourceImportMode = 'skip'

    const toastId = toast.loading(t('sendResource.sendingTo', { resource: resourceLabel, workspace: targetName }))

    try {
      // 1. Export the selected resource(s) from current workspace
      const exportOptions: ExportResourcesOptions = {}
      if (resourceType === 'source') exportOptions.sources = resourceIds
      else if (resourceType === 'skill') exportOptions.skills = resourceIds
      else throw new Error('Automation transfer is not available in this build')

      const { bundle, warnings: exportWarnings } = await window.electronAPI.exportResources(
        activeWorkspaceId,
        exportOptions,
      )

      // 2. Import into the local target workspace
      const importResult = await window.electronAPI.importResources(
        selectedWorkspaceId,
        bundle,
        mode,
      )

      // 3. Report result
      const bucket = resourceType === 'source' ? importResult.sources : importResult.skills
      const imported = bucket?.imported?.length ?? 0
      const skipped = bucket?.skipped?.length ?? 0

      if (imported > 0 && skipped === 0) {
        toast.success(t('sendResource.sentTo', { resource: resourceLabel, workspace: targetName }), { id: toastId })
      } else if (imported > 0 && skipped > 0) {
        toast.success(t('sendResource.sentWithSkipped', { imported, resourceType: label, skipped }), { id: toastId })
      } else if (skipped > 0) {
        toast.info(t('sendResource.alreadyExists', { resource: resourceLabel, workspace: targetName }), { id: toastId })
      } else {
        toast.warning(t('sendResource.nothingSent', { workspace: targetName }), { id: toastId })
      }

      if (exportWarnings.length > 0) {
        console.warn('[SendResource] Export warnings:', exportWarnings)
      }

      onOpenChange(false)
      setSelectedWorkspaceId(null)
      onTransferComplete?.()
    } catch (error: any) {
      const isUnsupported = error?.code === 'CHANNEL_NOT_FOUND' ||
        (error?.message ?? '').includes('No handler for')
      const message = isUnsupported
        ? t('sendResource.unsupportedVersion', { workspace: targetName })
        : error instanceof Error ? error.message : t('common.unknownError')
      toast.error(t('sendResource.failedToSend', { resourceType: label }), { id: toastId, description: message })
    } finally {
      setIsSending(false)
    }
  }, [selectedWorkspaceId, activeWorkspaceId, resourceIds, resourceType, resourceLabel, workspaces, onOpenChange, onTransferComplete, t])

  const { singular, plural } = RESOURCE_TYPE_LABELS[resourceType]

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isSending) {
        onOpenChange(isOpen)
        if (!isOpen) setSelectedWorkspaceId(null)
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            {t('sendResource.title')}
          </DialogTitle>
          <DialogDescription>
            {t('sendResource.description', { resource: resourceLabel })}
          </DialogDescription>
        </DialogHeader>

        {/* Workspace list */}
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto py-1">
          {targetWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-4 text-center">
              {t('sendResource.noOtherWorkspaces')}
            </p>
          ) : (
            targetWorkspaces.map(workspace => {
              const isSelected = selectedWorkspaceId === workspace.id
              return (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={isSending}
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-foreground/10 ring-1 ring-foreground/15',
                  )}
                >
                  <WorkspaceAvatar
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    src={workspaceIconMap.get(workspace.id)}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50 shrink-0"
                    fallbackClassName="rounded-full"
                  />
                  <span className="flex-1 truncate">{workspace.name}</span>
                  <Monitor className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                </button>
              )
            })
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedWorkspaceId || isSending}
          >
            {isSending ? t('common.sending') : t('common.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
