import * as React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import type { MessagingPlatformRuntimeInfo } from '../../../shared/types'

interface WhatsAppConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function WhatsAppConnectDialog({ open, onOpenChange, onConnected }: WhatsAppConnectDialogProps) {
  const { t } = useTranslation()
  const [runtime, setRuntime] = React.useState<MessagingPlatformRuntimeInfo | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    const runtimes = await window.electronAPI.getMessagingRuntime()
    setRuntime(runtimes.find(item => item.platform === 'whatsapp') ?? null)
  }, [])

  React.useEffect(() => {
    if (!open) return
    let active = true
    setError(null)
    void (async () => {
      try {
        await window.electronAPI.connectMessagingPlatform('whatsapp')
        if (active) await refresh()
      } catch {
        if (active) setError(t('dialog.whatsapp.startFailed'))
      }
    })()
    const offStatus = window.electronAPI.onMessagingPlatformStatus((_workspaceId, update) => {
      const updates = Array.isArray(update) ? update : [update]
      const whatsapp = updates.find(item => item.platform === 'whatsapp')
      if (!whatsapp || !active) return
      setRuntime(whatsapp)
      if (whatsapp.connected) onConnected()
    })
    return () => { active = false; offStatus() }
  }, [open, onConnected, refresh])

  const retry = async () => {
    setError(null)
    try {
      await window.electronAPI.connectMessagingPlatform('whatsapp')
      await refresh()
    } catch {
      setError(t('dialog.whatsapp.startFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.whatsapp.title')}</DialogTitle>
          <DialogDescription>{t('dialog.whatsapp.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-56 items-center justify-center">
          {runtime?.qrCode ? (
            <div className="rounded-lg bg-white p-4"><QRCodeSVG value={runtime.qrCode} size={200} /></div>
          ) : error || runtime?.lastError ? (
            <p className="text-center text-sm text-destructive">{error || runtime?.lastError}</p>
          ) : (
            <p className="text-center text-sm text-muted-foreground">{t('dialog.whatsapp.starting')}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="outline" onClick={() => void retry()}>{t('dialog.whatsapp.refreshQr')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
