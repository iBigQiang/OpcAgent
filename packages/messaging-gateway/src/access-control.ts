import type { ChannelBinding, MessagingConfig, PlatformType } from './types'

/** Deny by default whenever a platform is locked and has no owner configuration. */
export function isSenderAllowed(config: MessagingConfig, binding: ChannelBinding, senderId: string): boolean {
  const platform = config.access?.[binding.platform]
  if (binding.config.accessMode === 'open') return true
  if (binding.config.accessMode === 'allow-list') return binding.config.allowedSenderIds?.includes(senderId) ?? false
  if (platform?.mode === 'owner-only') return platform.ownerIds.includes(senderId)
  return true
}

/** Owner-only without a configured owner is deliberately fail-closed. */
export function isPlatformSenderAllowed(config: MessagingConfig, platform: PlatformType, senderId: string): boolean {
  const access = config.access?.[platform]
  if (access?.mode !== 'owner-only') return true
  return access.ownerIds.includes(senderId)
}

export function setPlatformOwners(config: MessagingConfig, platform: PlatformType, ownerIds: string[]): MessagingConfig {
  const owners = [...new Set(ownerIds.filter(id => typeof id === 'string' && id.length > 0))]
  return { ...config, access: { ...config.access, [platform]: { mode: config.access?.[platform]?.mode ?? 'open', ownerIds: owners } } }
}

/** The first successful private pairing establishes a locked owner set. */
export function seedFirstPlatformOwner(config: MessagingConfig, platform: PlatformType, senderId: string): MessagingConfig {
  const current = config.access?.[platform]
  if (current?.ownerIds.length) return config
  return {
    ...config,
    access: { ...config.access, [platform]: { mode: 'owner-only', ownerIds: [senderId] } },
  }
}
