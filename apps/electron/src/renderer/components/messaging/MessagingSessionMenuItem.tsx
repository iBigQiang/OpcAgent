import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { navigate, routes } from '@/lib/navigate'
import { useMenuComponents } from '@/components/ui/menu-context'
import { messagingDialogAtom } from '@/atoms/messaging'
import type { MessagingPlatform } from '../../../shared/types'

export interface UseMessagingConnectOptions {
  sessionId: string
  onPlatformNotConfigured?: () => void
  classifyError?: (error: unknown, t: TFunction) => string
}

/** Shared session-menu pairing flow for full and compact session menus. */
export function useMessagingConnect({ sessionId, onPlatformNotConfigured, classifyError = classifyMessagingError }: UseMessagingConnectOptions) {
  const { t } = useTranslation()
  const setMessagingDialog = useSetAtom(messagingDialogAtom)
  return React.useCallback(async (platform: MessagingPlatform) => {
    try {
      const runtime = (await window.electronAPI.getMessagingRuntime()).find(item => item.platform === platform)
      if (!runtime?.connected) {
        if (platform === 'whatsapp') setMessagingDialog({ kind: 'wa_connect', continueToPairingSessionId: sessionId })
        else if (onPlatformNotConfigured) onPlatformNotConfigured()
        else {
          navigate(routes.view.settings('messaging'))
          toast.info(t('toast.messagingNotConfigured'))
        }
        return
      }
    } catch {
      // Pairing RPC returns a useful error if the runtime check cannot load.
    }
    setMessagingDialog({ kind: 'pairing', platform, sessionId, code: null, expiresAt: null })
    try {
      const result = await window.electronAPI.generateMessagingPairingCode(sessionId, platform)
      setMessagingDialog({ kind: 'pairing', platform, sessionId, code: result.code, expiresAt: result.expiresAt, botUsername: result.botUsername })
    } catch (error) {
      setMessagingDialog({ kind: 'pairing', platform, sessionId, code: null, expiresAt: null, error: classifyError(error, t) })
    }
  }, [classifyError, onPlatformNotConfigured, sessionId, setMessagingDialog, t])
}

export function MessagingSessionMenuItem(props: UseMessagingConnectOptions) {
  const { t } = useTranslation()
  const { MenuItem, Sub, SubTrigger, SubContent } = useMenuComponents()
  const connect = useMessagingConnect(props)
  return <Sub>
    <SubTrigger className="pr-2"><MessageSquare className="h-3.5 w-3.5" /><span className="flex-1">{t('sessionMenu.connectMessaging')}</span></SubTrigger>
    <SubContent>
      <MenuItem onClick={() => void connect('telegram')}>Telegram</MenuItem>
      <MenuItem onClick={() => void connect('whatsapp')}>WhatsApp</MenuItem>
      <MenuItem onClick={() => void connect('lark')}>Lark / Feishu</MenuItem>
    </SubContent>
  </Sub>
}

export function classifyMessagingError(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/platform not connected|no adapter|not configured/i.test(message)) return t('toast.messagingNotConfigured')
  if (/rate.?limit/i.test(message)) return t('toast.messagingRateLimited')
  return message
}
