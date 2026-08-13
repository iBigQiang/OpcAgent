import { useTranslation } from 'react-i18next'
import { ACTION_CATEGORY_KEYS, actionsByCategory, useActionLabel, type ActionId } from '@/actions'

export function KeyboardShortcuts() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      {Object.entries(actionsByCategory).map(([category, actions]) => (
        <section key={category}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            {t(ACTION_CATEGORY_KEYS[category as keyof typeof ACTION_CATEGORY_KEYS])}
          </h3>
          <div className="space-y-1">
            {actions.map(action => (
              <ShortcutRow key={action.id} actionId={action.id as ActionId} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ShortcutRow({ actionId }: { actionId: ActionId }) {
  const { label, description, hotkey } = useActionLabel(actionId)

  return (
    <div className="flex items-center justify-between py-1.5">
      <div>
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {hotkey && (
        <kbd className="px-2 py-1 text-xs bg-muted rounded">{hotkey}</kbd>
      )}
    </div>
  )
}
