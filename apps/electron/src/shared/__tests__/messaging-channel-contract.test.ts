import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@opcagent/shared/protocol'
import { CHANNEL_MAP } from '../../transport/channel-map'

describe('restored Messaging renderer contract', () => {
  test('maps pairing, supergroup, WhatsApp, and exact pending actions', () => {
    expect(CHANNEL_MAP.generateMessagingPairingCode.channel).toBe(RPC_CHANNELS.messaging.GENERATE_CODE)
    expect(CHANNEL_MAP.unbindMessagingSession.channel).toBe(RPC_CHANNELS.messaging.UNBIND)
    expect(CHANNEL_MAP.generateMessagingSupergroupCode.channel).toBe(RPC_CHANNELS.messaging.GENERATE_SUPERGROUP_CODE)
    expect(CHANNEL_MAP.getMessagingSupergroup.channel).toBe(RPC_CHANNELS.messaging.GET_SUPERGROUP)
    expect(CHANNEL_MAP.unbindMessagingSupergroup.channel).toBe(RPC_CHANNELS.messaging.UNBIND_SUPERGROUP)
    expect(CHANNEL_MAP.startWhatsAppConnect.channel).toBe(RPC_CHANNELS.messaging.WA_START_CONNECT)
    expect(CHANNEL_MAP.submitWhatsAppPhone.channel).toBe(RPC_CHANNELS.messaging.WA_SUBMIT_PHONE)
    expect(CHANNEL_MAP.allowMessagingPendingSender.channel).toBe(RPC_CHANNELS.messaging.ALLOW_PENDING_SENDER)
    expect(CHANNEL_MAP.dismissMessagingPendingSender.channel).toBe(RPC_CHANNELS.messaging.DISMISS_PENDING_SENDER)
  })
})
