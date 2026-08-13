import type { HandlerDeps as BaseHandlerDeps } from '@opcagent/server-core/handlers'
import type { SessionManager } from '@opcagent/server-core/sessions'
import type { BrowserPaneManager } from '../browser-pane-manager'
import type { WindowManager } from '../window-manager'
import type { OAuthFlowStore } from '@opcagent/shared/auth'

export type HandlerDeps = BaseHandlerDeps<SessionManager, OAuthFlowStore, WindowManager, BrowserPaneManager>
