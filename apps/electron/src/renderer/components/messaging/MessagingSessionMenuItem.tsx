import { MessageSquare } from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { useMenuComponents } from '@/components/ui/menu-context'
export function MessagingSessionMenuItem() {
  const { MenuItem } = useMenuComponents()
  return <MenuItem onClick={() => navigate(routes.view.settings('messaging'))}><MessageSquare className="h-3.5 w-3.5" /><span className="flex-1">Messaging settings</span></MenuItem>
}
