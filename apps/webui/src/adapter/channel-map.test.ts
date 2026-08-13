import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import { CHANNEL_MAP } from '../../../electron/src/transport/channel-map'

describe('WebUI Client API contract', () => {
  it('maps retained and restored product surfaces', () => {
    expect(CHANNEL_MAP.getSessions.channel).toBe(RPC_CHANNELS.sessions.GET)
    expect(CHANNEL_MAP.getSkills.channel).toBe(RPC_CHANNELS.skills.GET)
    expect(CHANNEL_MAP.setupLlmConnection.channel).toBe(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)
    expect(CHANNEL_MAP['browserPane.create'].channel).toBe(RPC_CHANNELS.browserPane.CREATE)
    expect(CHANNEL_MAP.getProjects.channel).toBe(RPC_CHANNELS.projects.GET)
    expect(CHANNEL_MAP.listLabels.channel).toBe(RPC_CHANNELS.labels.LIST)
    expect(CHANNEL_MAP.getAutomations.channel).toBe(RPC_CHANNELS.automations.GET)
    expect(CHANNEL_MAP.getMessagingRuntime.channel).toBe(RPC_CHANNELS.messaging.GET_RUNTIME)
    expect(CHANNEL_MAP.onMessagingPendingChanged.channel).toBe(RPC_CHANNELS.messaging.PENDING_CHANGED)
    expect(CHANNEL_MAP.generateMessagingPairingCode.channel).toBe(RPC_CHANNELS.messaging.GENERATE_CODE)
    expect(CHANNEL_MAP.generateMessagingSupergroupCode.channel).toBe(RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE)
    expect(CHANNEL_MAP.startWhatsAppConnect.channel).toBe(RPC_CHANNELS.messaging.WA_START_CONNECT)
  })

  it('contains only channels that exist in the shared protocol', () => {
    const channels = new Set<string>(Object.values(RPC_CHANNELS).flatMap(group => Object.values(group)))
    for (const entry of Object.values(CHANNEL_MAP)) {
      // Preload-local pseudo-channels (prefixed with `__`) are dispatched inside
      // the preload script and never cross the RPC boundary, so they do not — and
      // should not — appear in the shared protocol.
      if (entry.channel.startsWith('__')) continue
      expect(channels.has(entry.channel)).toBe(true)
    }
  })
})
