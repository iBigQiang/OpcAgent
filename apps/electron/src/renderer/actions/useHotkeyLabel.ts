import { useTranslation } from 'react-i18next'
import { useActionRegistry } from './registry'
import type { ActionId } from './definitions'

export const ACTION_LABEL_KEYS: Record<ActionId, string> = {
  'app.keyboardShortcuts': 'shortcuts.action.keyboardShortcuts',
  'app.newChat': 'shortcuts.action.newChat',
  'app.newChatInPanel': 'shortcuts.action.newChatInPanel',
  'app.newWindow': 'shortcuts.action.newWindow',
  'app.quit': 'shortcuts.action.quit',
  'app.search': 'shortcuts.action.search',
  'app.settings': 'shortcuts.action.settings',
  'app.toggleTheme': 'shortcuts.action.toggleTheme',
  'chat.cyclePermissionMode': 'shortcuts.action.cyclePermissionMode',
  'chat.nextSearchMatch': 'shortcuts.action.nextSearchMatch',
  'chat.prevSearchMatch': 'shortcuts.action.prevSearchMatch',
  'chat.stopProcessing': 'shortcuts.action.stopProcessing',
  'nav.focusChat': 'shortcuts.action.focusChat',
  'nav.focusNavigator': 'shortcuts.action.focusNavigator',
  'nav.focusSidebar': 'shortcuts.action.focusSidebar',
  'nav.goBack': 'shortcuts.action.goBack',
  'nav.goBackAlt': 'shortcuts.action.goBack',
  'nav.goForward': 'shortcuts.action.goForward',
  'nav.goForwardAlt': 'shortcuts.action.goForward',
  'nav.nextZone': 'shortcuts.action.focusNextZone',
  'navigator.clearSelection': 'shortcuts.action.clearSelection',
  'navigator.selectAll': 'shortcuts.action.selectAll',
  'panel.focusNext': 'shortcuts.action.focusNextPanel',
  'panel.focusPrev': 'shortcuts.action.focusPrevPanel',
  'view.toggleFocusMode': 'shortcuts.action.toggleFocusMode',
  'view.toggleSidebar': 'shortcuts.action.toggleSidebar',
}

export const ACTION_CATEGORY_KEYS = {
  Chat: 'shortcuts.category.chat',
  General: 'shortcuts.category.general',
  Navigation: 'shortcuts.category.navigation',
  Navigator: 'shortcuts.category.navigator',
  View: 'shortcuts.category.view',
} as const

const ACTION_DESCRIPTION_KEYS: Partial<Record<ActionId, string>> = {
  'app.keyboardShortcuts': 'shortcuts.description.keyboardShortcuts',
  'app.newChat': 'shortcuts.description.newChat',
  'app.newChatInPanel': 'shortcuts.description.newChatInPanel',
  'app.newWindow': 'shortcuts.description.newWindow',
  'app.quit': 'shortcuts.description.quit',
  'app.search': 'shortcuts.description.search',
  'app.settings': 'shortcuts.description.settings',
  'app.toggleTheme': 'shortcuts.description.toggleTheme',
  'chat.cyclePermissionMode': 'shortcuts.description.cyclePermissionMode',
  'chat.stopProcessing': 'shortcuts.description.stopProcessing',
  'nav.goBack': 'shortcuts.description.goBack',
  'nav.goBackAlt': 'shortcuts.description.goBackAlt',
  'nav.goForward': 'shortcuts.description.goForward',
  'nav.goForwardAlt': 'shortcuts.description.goForwardAlt',
  'panel.focusNext': 'shortcuts.description.focusNextPanel',
  'panel.focusPrev': 'shortcuts.description.focusPrevPanel',
  'view.toggleFocusMode': 'shortcuts.description.toggleFocusMode',
}

/**
 * Get the display string for an action's hotkey.
 *
 * @example
 * const hotkey = useHotkeyLabel('app.newChat') // "⌘N" on Mac
 *
 * @example
 * // In a tooltip
 * <Tooltip content={`New Chat ${useHotkeyLabel('app.newChat')}`}>
 */
export function useHotkeyLabel(actionId: ActionId): string | null {
  const { getHotkeyDisplay } = useActionRegistry()
  return getHotkeyDisplay(actionId)
}

/**
 * Get the action label and hotkey for display.
 *
 * @example
 * const { label, hotkey } = useActionLabel('app.newChat')
 * // label: "New Chat", hotkey: "⌘N"
 */
export function useActionLabel(actionId: ActionId) {
  const { t } = useTranslation()
  const { getAction, getHotkeyDisplay } = useActionRegistry()
  const action = getAction(actionId)
  const description = 'description' in action ? action.description : undefined
  const descriptionKey = ACTION_DESCRIPTION_KEYS[actionId]
  return {
    label: t(ACTION_LABEL_KEYS[actionId], { defaultValue: action.label }),
    description: descriptionKey && description
      ? t(descriptionKey, { defaultValue: description })
      : description,
    hotkey: getHotkeyDisplay(actionId),
  }
}
