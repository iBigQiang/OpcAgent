export const OPCAGENT_RELEASES_URL = 'https://github.com/iBigQiang/OpcAgent/releases'

export function getWhatsNewFallbackContent(t: (key: string) => string): string {
  return `# ${t('whatsNew.unavailableTitle')}\n\n${t('whatsNew.unavailableDescription')}\n\n[${t('whatsNew.viewReleases')}](${OPCAGENT_RELEASES_URL})`
}
