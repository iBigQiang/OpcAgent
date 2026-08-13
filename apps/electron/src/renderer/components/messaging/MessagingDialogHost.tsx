import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { messagingDialogAtom } from '@/atoms/messaging'
import { PairingCodeDialog } from './PairingCodeDialog'
import { WhatsAppConnectDialog } from './WhatsAppConnectDialog'

/** Global pairing/connect dialog host; it deliberately outlives a closing session menu. */
export function MessagingDialogHost() {
  const [state, setState] = useAtom(messagingDialogAtom)
  const { t } = useTranslation()
  const close = () => setState({ kind: 'closed' })
  const stateRef = React.useRef(state)
  stateRef.current = state
  const isWaitingForPair = state.kind === 'pairing' && state.code !== null

  React.useEffect(() => {
    if (!isWaitingForPair) return
    return window.electronAPI.onMessagingBindingChanged(async () => {
      const current = stateRef.current
      if (current.kind !== 'pairing' || current.code === null) return
      try {
        const bindings = await window.electronAPI.getMessagingBindings()
        if (bindings.some(binding => binding.enabled && binding.sessionId === current.sessionId && binding.platform === current.platform)) {
          toast.success(t('toast.messagingPaired'))
          close()
        }
      } catch {
        // Leave the code visible when a refresh cannot confirm the binding.
      }
    })
  }, [isWaitingForPair, t])

  const openPairing = async (sessionId: string, platform: 'telegram' | 'whatsapp') => {
    setState({ kind: 'pairing', platform, sessionId, code: null, expiresAt: null })
    try {
      const result = await window.electronAPI.generateMessagingPairingCode(sessionId, platform)
      setState({ kind: 'pairing', platform, sessionId, code: result.code, expiresAt: result.expiresAt, botUsername: result.botUsername })
    } catch (error) {
      setState({ kind: 'pairing', platform, sessionId, code: null, expiresAt: null, error: classifyMessagingError(error) })
    }
  }

  const handleWhatsAppConnected = () => {
    if (state.kind === 'wa_connect' && state.continueToPairingSessionId) {
      void openPairing(state.continueToPairingSessionId, 'whatsapp')
      return
    }
    close()
  }

  return <>
    <PairingCodeDialog
      open={state.kind === 'pairing'}
      onOpenChange={open => { if (!open) close() }}
      platform={state.kind === 'pairing' ? state.platform : 'telegram'}
      code={state.kind === 'pairing' ? state.code : null}
      expiresAt={state.kind === 'pairing' ? state.expiresAt : null}
      botUsername={state.kind === 'pairing' ? state.botUsername : undefined}
      error={state.kind === 'pairing' ? state.error : undefined}
    />
    <WhatsAppConnectDialog
      open={state.kind === 'wa_connect'}
      onOpenChange={open => { if (!open) close() }}
      onConnected={handleWhatsAppConnected}
    />
  </>
}

function classifyMessagingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/not connected/i.test(message)) return 'WhatsApp is not connected yet. Reconnect it in Settings and try again.'
  if (/rate.?limit/i.test(message)) return 'Too many pairing-code requests. Please wait and try again.'
  return message
}
