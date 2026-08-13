import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

type LarkDomain = 'lark' | 'feishu'

type MessagingTestAPI = {
  testLarkCredentials(credentials: { appId: string; appSecret: string; domain: LarkDomain }): Promise<{ success: boolean; error?: string }>
}

interface LarkConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function LarkConnectDialog({ open, onOpenChange, onConnected }: LarkConnectDialogProps) {
  const { t } = useTranslation()
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [domain, setDomain] = React.useState<LarkDomain>('lark')
  const [tested, setTested] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const reset = () => {
    setAppId('')
    setAppSecret('')
    setDomain('lark')
    setTested(false)
    setBusy(false)
    setError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const test = async () => {
    if (!appId.trim() || !appSecret.trim()) return
    setBusy(true)
    setError(null)
    setTested(false)
    try {
      const credentials = { appId: appId.trim(), appSecret: appSecret.trim(), domain }
      const result = await (window.electronAPI as typeof window.electronAPI & MessagingTestAPI).testLarkCredentials(credentials)
      if (!result.success) {
        setError(result.error || t('settings.messaging.lark.testFailed'))
        return
      }
      setTested(true)
    } catch {
      setError(t('settings.messaging.lark.testFailed'))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!tested || !appId.trim() || !appSecret.trim()) return
    setBusy(true)
    setError(null)
    try {
      await window.electronAPI.saveMessagingCredential('lark', JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim(), domain }))
      await window.electronAPI.connectMessagingPlatform('lark')
      reset()
      onConnected()
    } catch {
      setError(t('settings.messaging.lark.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('settings.messaging.lark.connectTitle')}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{t('settings.messaging.lark.instructions')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('settings.messaging.lark.domainLabel')}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={domain === 'lark' ? 'default' : 'outline'} onClick={() => { setDomain('lark'); setTested(false) }}>{t('settings.messaging.lark.domainLark')}</Button>
              <Button type="button" size="sm" variant={domain === 'feishu' ? 'default' : 'outline'} onClick={() => { setDomain('feishu'); setTested(false) }}>{t('settings.messaging.lark.domainFeishu')}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="lark-app-id">{t('settings.messaging.lark.appIdLabel')}</label>
            <input id="lark-app-id" value={appId} onChange={event => { setAppId(event.target.value); setTested(false); setError(null) }} placeholder={t('settings.messaging.lark.appIdPlaceholder')} autoComplete="off" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="lark-app-secret">{t('settings.messaging.lark.appSecretLabel')}</label>
            <input id="lark-app-secret" type="password" value={appSecret} onChange={event => { setAppSecret(event.target.value); setTested(false); setError(null) }} placeholder={t('settings.messaging.lark.appSecretPlaceholder')} autoComplete="off" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
          </div>
          {tested && <p className="text-sm text-emerald-600">{t('settings.messaging.lark.testOk')}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="outline" onClick={() => void test()} disabled={busy || !appId.trim() || !appSecret.trim()}>{t('settings.messaging.lark.testConnection')}</Button>
          <Button onClick={() => void save()} disabled={busy || !tested}>{t('settings.messaging.lark.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
