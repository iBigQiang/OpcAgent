import { registerCustomTheme, resolveTheme } from '@pierre/diffs'

const GLOBAL_THEME_KEY = '__opcagentShikiThemesRegistered__'

/**
 * Register opcagent-dark / opcagent-light Shiki themes once per runtime.
 * Prevents duplicate registration warnings during HMR or StrictMode re-mounts.
 */
export function registerOPCAgentShikiThemes() {
  if (typeof globalThis === 'undefined') return
  const globalRef = globalThis as typeof globalThis & { [GLOBAL_THEME_KEY]?: boolean }
  if (globalRef[GLOBAL_THEME_KEY]) return
  globalRef[GLOBAL_THEME_KEY] = true

  registerCustomTheme('opcagent-dark', async () => {
    const theme = await resolveTheme('pierre-dark')
    return { ...theme, name: 'opcagent-dark', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })

  registerCustomTheme('opcagent-light', async () => {
    const theme = await resolveTheme('pierre-light')
    return { ...theme, name: 'opcagent-light', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })
}
