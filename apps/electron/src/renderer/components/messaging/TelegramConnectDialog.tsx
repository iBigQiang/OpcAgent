import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

type MessagingTestAPI = {
  testTelegramToken(token: string): Promise<{ success: boolean; error?: string }>
}

interface TelegramConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function TelegramConnectDialog({ open, onOpenChange, onConnected }: TelegramConnectDialogProps) {
  const { t } = useTranslation()
  const [token, setToken] = React.useState('')
  const [tested, setTested] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const reset = () => {
    setToken('')
    setTested(false)
    setBusy(false)
    setError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const test = async () => {
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    setTested(false)
    try {
      const result = await (window.electronAPI as typeof window.electronAPI & MessagingTestAPI).testTelegramToken(token.trim())
      if (!result.success) {
        setError(result.error || t('settings.messaging.telegram.testFailed'))
        return
      }
      setTested(true)
    } catch {
      setError(t('settings.messaging.telegram.testFailed'))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!tested || !token.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.electronAPI.saveMessagingCredential('telegram', token.trim())
      await window.electronAPI.connectMessagingPlatform('telegram')
      reset()
      onConnected()
    } catch {
      setError(t('settings.messaging.telegram.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('settings.messaging.telegram.connectTitle')}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{t('settings.messaging.telegram.instructions')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="telegram-bot-token">{t('settings.messaging.telegram.tokenLabel')}</label>
          <input
            id="telegram-bot-token"
            type="password"
            value={token}
            onChange={event => { setToken(event.target.value); setTested(false); setError(null) }}
            placeholder={t('settings.messaging.telegram.tokenPlaceholder')}
            autoComplete="off"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
          {tested && <p className="text-sm text-emerald-600">{t('settings.messaging.telegram.testOk')}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="outline" onClick={() => void test()} disabled={busy || !token.trim()}>{t('settings.messaging.telegram.testConnection')}</Button>
          <Button onClick={() => void save()} disabled={busy || !tested}>{t('settings.messaging.telegram.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
