import { describe, expect, it } from 'bun:test'
import { getWhatsNewFallbackContent, OPCAGENT_RELEASES_URL } from '../whats-new'

describe('getWhatsNewFallbackContent', () => {
  it('keeps a visible local exit path and external Releases link when notes are unavailable', () => {
    const content = getWhatsNewFallbackContent((key) => `translated:${key}`)

    expect(content.trim()).not.toBe('')
    expect(content).toContain('# translated:whatsNew.unavailableTitle')
    expect(content).toContain('translated:whatsNew.unavailableDescription')
    expect(content).toContain(`[translated:whatsNew.viewReleases](${OPCAGENT_RELEASES_URL})`)
  })
})
