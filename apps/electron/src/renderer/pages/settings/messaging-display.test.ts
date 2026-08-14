import { describe, expect, it } from 'bun:test'
import { getDirectSessionDisplay } from './messaging-display'

describe('getDirectSessionDisplay', () => {
  it('shows the Telegram chat, provider connection, and model beside a named session', () => {
    expect(getDirectSessionDisplay(
      {
        sessionLabel: 'Release review',
        channelLabel: 'Alice',
        llmConnection: 'team-openai',
        model: 'gpt-5.4',
      },
      [{ slug: 'team-openai', name: 'Team OpenAI', providerType: 'openai' }],
    )).toEqual({
      title: 'Release review',
      details: ['Telegram · Alice', 'openai · Team OpenAI', 'gpt-5.4'],
    })
  })

  it('inherits the workspace connection and its default model when a legacy session has no overrides', () => {
    expect(getDirectSessionDisplay(
      {
        sessionLabel: 'Legacy session',
        channelLabel: 'Alice',
        workspaceDefaultLlmConnection: 'workspace-default',
      },
      [{
        slug: 'workspace-default',
        name: 'Workspace OpenAI',
        providerType: 'openai',
        defaultModel: 'gpt-5.4-mini',
      }],
    )).toEqual({
      title: 'Legacy session',
      details: ['Telegram · Alice', 'openai · Workspace OpenAI', 'gpt-5.4-mini'],
    })
  })

  it('uses the marked default connection, then the first connection, when no workspace default exists', () => {
    expect(getDirectSessionDisplay(
      { sessionLabel: 'Default session' },
      [
        { slug: 'first', name: 'First', providerType: 'pi', defaultModel: 'first-model' },
        { slug: 'default', name: 'Default', providerType: 'pi_compat', isDefault: true, defaultModel: 'default-model' },
      ],
    ).details).toEqual(['pi_compat · Default', 'default-model'])
  })

  it('falls back safely when session metadata or a resolved connection is unavailable', () => {
    expect(getDirectSessionDisplay(
      {
        sessionLabel: '123456',
        channelLabel: '123456',
        llmConnection: 'missing-connection',
      },
      [],
    )).toEqual({
      title: '123456',
      details: ['Telegram · 123456', 'missing-connection'],
    })
  })

  it('omits optional details instead of rendering empty separators', () => {
    expect(getDirectSessionDisplay({ sessionLabel: 'New chat' }, [])).toEqual({
      title: 'New chat',
      details: [],
    })
  })
})
