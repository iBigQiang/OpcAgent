import type { ThemeOverrides } from '../config/index.ts';
import type { LoadedSkill } from '../skills/types.ts';
import type { LoadedSource } from '../sources/types.ts';
import { RPC_CHANNELS } from './channels.ts';
import type {
  BrowserInstanceInfo,
  DeepLinkNavigation,
  SessionEvent,
  UnreadSummary,
  UpdateInfo,
} from './dto.ts';
import type { LoadedProject } from '../projects/types.ts';
import type { PlatformRuntimeInfo } from '@opcagent/messaging-gateway';

export type WhatsAppUiEvent =
  | { type: 'qr'; qr: string }
  | { type: 'pairing_code'; code: string }
  | { type: 'connected'; jid?: string; name?: string }
  | { type: 'disconnected'; loggedOut: boolean; reason?: string }
  | { type: 'unavailable'; reason: string; message: string }
  | { type: 'error'; message: string };

export interface BroadcastEventMap {
  [RPC_CHANNELS.sessions.EVENT]: [event: SessionEvent];
  [RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED]: [summary: UnreadSummary];
  [RPC_CHANNELS.sessions.FILES_CHANGED]: [sessionId: string];
  [RPC_CHANNELS.sources.CHANGED]: [workspaceId: string, sources: LoadedSource[]];
  [RPC_CHANNELS.skills.CHANGED]: [workspaceId: string, skills: LoadedSkill[]];
  [RPC_CHANNELS.labels.CHANGED]: [workspaceId: string];
  [RPC_CHANNELS.projects.CHANGED]: [workspaceId: string, projects: LoadedProject[]];
  [RPC_CHANNELS.automations.CHANGED]: [workspaceId: string];
  [RPC_CHANNELS.messaging.BINDING_CHANGED]: [workspaceId: string];
  [RPC_CHANNELS.messaging.PLATFORM_STATUS]: [workspaceId: string, runtime: PlatformRuntimeInfo | PlatformRuntimeInfo[]];
  [RPC_CHANNELS.messaging.PENDING_CHANGED]: [workspaceId: string];
  [RPC_CHANNELS.messaging.WA_UI_EVENT]: [workspaceId: string, event: WhatsAppUiEvent];
  [RPC_CHANNELS.llmConnections.CHANGED]: [];
  [RPC_CHANNELS.permissions.DEFAULTS_CHANGED]: [value: null];
  [RPC_CHANNELS.theme.APP_CHANGED]: [theme: ThemeOverrides | null];
  [RPC_CHANNELS.theme.SYSTEM_CHANGED]: [isDark: boolean];
  [RPC_CHANNELS.theme.PREFERENCES_CHANGED]: [preferences: { mode: string; colorTheme: string; font: string }];
  [RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED]: [data: { workspaceId: string; themeId: string | null }];
  [RPC_CHANNELS.update.AVAILABLE]: [info: UpdateInfo];
  [RPC_CHANNELS.update.DOWNLOAD_PROGRESS]: [progress: number];
  [RPC_CHANNELS.badge.DRAW]: [data: { count: number; iconDataUrl: string }];
  [RPC_CHANNELS.badge.DRAW_WINDOWS]: [data: { count: number }];
  [RPC_CHANNELS.window.FOCUS_STATE]: [isFocused: boolean];
  [RPC_CHANNELS.window.CLOSE_REQUESTED]: [];
  [RPC_CHANNELS.browserPane.STATE_CHANGED]: [info: BrowserInstanceInfo];
  [RPC_CHANNELS.browserPane.REMOVED]: [id: string];
  [RPC_CHANNELS.browserPane.INTERACTED]: [id: string];
  [RPC_CHANNELS.notification.NAVIGATE]: [data: { workspaceId: string; sessionId: string }];
  [RPC_CHANNELS.deeplink.NAVIGATE]: [navigation: DeepLinkNavigation];
  [RPC_CHANNELS.menu.NEW_CHAT]: [];
  [RPC_CHANNELS.menu.OPEN_SETTINGS]: [];
  [RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS]: [];
  [RPC_CHANNELS.menu.TOGGLE_FOCUS_MODE]: [];
  [RPC_CHANNELS.menu.TOGGLE_SIDEBAR]: [];
}
