import type { ChannelBinding, MessagingConfig, PlatformType } from './types'

/** Deny by default whenever a platform is locked and has no owner configuration. */
export function isSenderAllowed(config: MessagingConfig, binding: ChannelBinding, senderId: string): boolean {
  const platform = config.access?.[binding.platform]
  if (binding.config.accessMode === 'open') return true
  if (binding.config.accessMode === 'allow-list') return binding.config.allowedSenderIds?.includes(senderId) ?? false
  if (platform?.mode === 'owner-only') return platform.ownerIds.includes(senderId)
  return true
}

export function setPlatformOwners(config: MessagingConfig, platform: PlatformType, ownerIds: string[]): MessagingConfig {
  const owners = [...new Set(ownerIds.filter(id => typeof id === 'string' && id.length > 0))]
  return { ...config, access: { ...config.access, [platform]: { mode: config.access?.[platform]?.mode ?? 'open', ownerIds: owners } } }
}
