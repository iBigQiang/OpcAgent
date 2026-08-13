import * as React from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props { open: boolean; onOpenChange: (open: boolean) => void; botUsername?: string; onPaired?: () => void }

export function TelegramSupergroupPairingDialog({ open, onOpenChange, botUsername, onPaired }: Props) {
  const { t } = useTranslation()
  const [code, setCode] = React.useState<string | null>(null)
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = React.useState(0)
  React.useEffect(() => {
    if (!open) { setCode(null); setExpiresAt(null); setError(null); return }
    let cancelled = false
    void window.electronAPI.generateMessagingSupergroupCode('telegram').then(result => {
      if (!cancelled) { setCode(result.code); setExpiresAt(result.expiresAt) }
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : t('common.error')) })
    return () => { cancelled = true }
  }, [open, t])
  React.useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setSecondsLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  React.useEffect(() => {
    if (!open || !code) return
    let cancelled = false
    const timer = setInterval(() => void window.electronAPI.getMessagingSupergroup().then(supergroup => {
      if (cancelled || !supergroup) return
      toast.success(t('settings.messaging.telegram.supergroup.pairedToast'))
      onPaired?.(); onOpenChange(false)
    }).catch(() => undefined), 1500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [code, onOpenChange, onPaired, open, t])
  const command = code ? `/pair ${code}` : ''
  const copy = async () => { try { await navigator.clipboard.writeText(command); toast.success(t('toast.copied')) } catch { toast.error(t('toast.copyFailed')) } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-[480px]"><DialogHeader><DialogTitle>{t('settings.messaging.telegram.supergroup.dialogTitle')}</DialogTitle><DialogDescription>{t('settings.messaging.telegram.supergroup.dialogDescription')}</DialogDescription></DialogHeader><div className="flex flex-col items-center gap-4 py-4">{error ? <p className="text-sm text-destructive">{error}</p> : code ? <><div className="rounded-lg bg-muted px-6 py-4 font-mono text-3xl font-bold tracking-[0.3em]">{code}</div><div className="flex items-center gap-2"><code className="rounded bg-muted px-2 py-1">{command}</code><button type="button" onClick={() => void copy()} title={t('common.copy')}><Copy className="h-4 w-4" /></button></div><p className="text-center text-sm text-muted-foreground">{t('settings.messaging.telegram.supergroup.dialogSendHint')}</p>{botUsername && <a href={`https://t.me/${botUsername}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary"><ExternalLink className="h-3.5 w-3.5" />@{botUsername}</a>}{secondsLeft > 0 && <p className="text-xs text-muted-foreground">{t('dialog.pairingCode.expiresIn', { minutes: Math.floor(secondsLeft / 60), seconds: String(secondsLeft % 60).padStart(2, '0') })}</p>}</> : <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}</div></DialogContent></Dialog>
}
