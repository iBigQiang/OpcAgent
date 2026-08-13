import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, PowerOff } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { LarkConnectDialog } from '@/components/messaging/LarkConnectDialog'
import { MessagingPlatformIcon } from '@/components/messaging/MessagingPlatformIcon'
import { TelegramConnectDialog } from '@/components/messaging/TelegramConnectDialog'
import { WhatsAppConnectDialog } from '@/components/messaging/WhatsAppConnectDialog'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { MessagingPlatform, MessagingPlatformRuntimeInfo } from '../../../shared/types'

const PLATFORMS: MessagingPlatform[] = ['telegram', 'whatsapp', 'lark']

export default function MessagingSettingsPage() {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const [runtime, setRuntime] = React.useState<Record<string, MessagingPlatformRuntimeInfo>>({})
  const [dialogPlatform, setDialogPlatform] = React.useState<MessagingPlatform | null>(null)
  const [disconnecting, setDisconnecting] = React.useState<MessagingPlatform | null>(null)

  const refresh = React.useCallback(async () => {
    if (!workspace) return
    const nextRuntime = await window.electronAPI.getMessagingRuntime()
    setRuntime(Object.fromEntries(nextRuntime.filter(item => item.platform).map(item => [item.platform!, item])))
  }, [workspace])

  React.useEffect(() => {
    if (!workspace) return
    void refresh()
    const offStatus = window.electronAPI.onMessagingPlatformStatus((workspaceId, update) => {
      if (workspaceId !== workspace.id) return
      const updates = Array.isArray(update) ? update : [update]
      setRuntime(current => ({
        ...current,
        ...Object.fromEntries(updates.filter(item => item.platform).map(item => [item.platform!, item])),
      }))
    })
    return offStatus
  }, [workspace, refresh])

  const disconnect = async (platform: MessagingPlatform) => {
    setDisconnecting(platform)
    try {
      await window.electronAPI.disconnectMessagingPlatform(platform)
      await refresh()
    } finally {
      setDisconnecting(null)
    }
  }

  const handleConnected = React.useCallback(() => {
    setDialogPlatform(null)
    void refresh()
  }, [refresh])

  if (!workspace) return null

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('settings.messaging.title')} />
      <ScrollArea className="flex-1">
        <div className="p-6">
          <SettingsSection title={t('settings.messaging.title')}>
            <div className="space-y-3">
              {PLATFORMS.map(platform => {
                const status = runtime[platform]
                const isConnected = status?.connected === true
                const title = platform === 'telegram'
                  ? t('settings.messaging.telegram.title')
                  : platform === 'whatsapp'
                    ? t('settings.messaging.whatsapp.title')
                    : t('settings.messaging.lark.title')
                const apiType = platform === 'telegram'
                  ? t('settings.messaging.telegram.apiType')
                  : platform === 'whatsapp'
                    ? t('settings.messaging.whatsapp.apiType')
                    : t('settings.messaging.lark.apiType')
                return (
                  <SettingsCard key={platform}>
                    <div className="flex items-center gap-4 p-5">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <MessagingPlatformIcon platform={platform} size={24} />
                        <div className="min-w-0">
                          <p className="font-medium">{title}</p>
                          <p className="text-xs text-muted-foreground">
                            {apiType} · {isConnected ? t('settings.messaging.connected') : t('settings.messaging.notConnected')}
                            {status?.identity ? ` · ${status.identity}` : ''}
                          </p>
                        </div>
                      </div>
                      {isConnected ? (
                        <Button variant="outline" size="sm" disabled={disconnecting === platform} onClick={() => void disconnect(platform)}>
                          <PowerOff className="h-4 w-4" />
                          {t('common.disconnect')}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => setDialogPlatform(platform)}>
                          <Plus className="h-4 w-4" />
                          {t('auth.connect')}
                        </Button>
                      )}
                    </div>
                  </SettingsCard>
                )
              })}
            </div>
          </SettingsSection>
        </div>
      </ScrollArea>

      <TelegramConnectDialog
        open={dialogPlatform === 'telegram'}
        onOpenChange={open => setDialogPlatform(open ? 'telegram' : null)}
        onConnected={handleConnected}
      />
      <WhatsAppConnectDialog
        open={dialogPlatform === 'whatsapp'}
        onOpenChange={open => setDialogPlatform(open ? 'whatsapp' : null)}
        onConnected={handleConnected}
      />
      <LarkConnectDialog
        open={dialogPlatform === 'lark'}
        onOpenChange={open => setDialogPlatform(open ? 'lark' : null)}
        onConnected={handleConnected}
      />
    </div>
  )
}
