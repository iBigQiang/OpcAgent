import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { delimiter, join } from 'node:path'
import { bootstrapServer } from '@opcagent/server-core/bootstrap'
import { cleanupSessionFileWatchForClient } from '@opcagent/server-core/handlers/rpc'
import { initModelRefreshService, setFetcherPlatform } from '@opcagent/server-core/model-fetchers'
import { setImageProcessor, setSearchPlatform } from '@opcagent/server-core/services'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@opcagent/server-core/sessions'
import {
  addWorkspace,
  ensurePresetThemes,
  ensureToolIcons,
  getPersistedUiLanguage,
  getWorkspaces,
  registerPiModelResolver,
  setPersistedUiLanguage,
} from '@opcagent/shared/config'
import { getCredentialManager } from '@opcagent/shared/credentials'
import { initializeDocs } from '@opcagent/shared/docs'
import { setupI18n, i18n, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@opcagent/shared/i18n'
import { ensureDefaultPermissions } from '@opcagent/shared/agent/permissions-config'
import { initializeBackendHostRuntime } from '@opcagent/shared/agent/backend'
import { initializeReleaseNotes } from '@opcagent/shared/release-notes'
import { getAllPiModels, getPiModelsForAuthProvider } from '@opcagent/shared/config'
import { getDefaultWorkspacesDir, ensureDefaultWorkspace } from '@opcagent/shared/workspaces'
import { createMessagingBootstrap } from '@opcagent/messaging-gateway'
import { setBundledAssetsRoot } from '@opcagent/shared/utils'
import { BrowserPaneManager } from './browser-pane-manager'
import { registerAllRpcHandlers } from './handlers'
import type { HandlerDeps } from './handlers/handler-deps'
import { mainLog } from './logger'
import { createElectronPlatform } from './platform'
import { WindowManager } from './window-manager'
import { checkForUpdatesOnLaunch, setAutoUpdateEventSink } from './auto-update'
import { handleDeepLink } from './deep-link'
import { createApplicationMenu, rebuildMenu, setMenuEventSink } from './menu'
import { registerThumbnailHandler, registerThumbnailScheme } from './thumbnail-protocol'

setupI18n()
const persistedUiLanguage = getPersistedUiLanguage()
if (persistedUiLanguage) void i18n.changeLanguage(persistedUiLanguage)
app.setName(process.env.OPCAGENT_APP_NAME || 'OPC Agent')
// Windows 通知需显式注册 AppUserModelID（与 electron-builder 的 appId 一致），
// 否则通知左上角会显示 Electron 默认身份（如 electron.app.OPC Agent）
if (process.platform === 'win32') {
  app.setAppUserModelId('app.opcagent.desktop')
}
if (process.env.OPCAGENT_USER_DATA_DIR) {
  app.setPath('userData', process.env.OPCAGENT_USER_DATA_DIR)
}

Sentry.init({
  dsn: process.env.SENTRY_ELECTRON_INGEST_URL,
  enabled: Boolean(process.env.SENTRY_ELECTRON_INGEST_URL),
  environment: app.isPackaged ? 'production' : 'development',
  release: app.getVersion(),
  beforeSend(event) {
    if (event.request?.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (/authorization|cookie|api[-_]?key/i.test(key)) event.request.headers[key] = '[REDACTED]'
      }
    }
    for (const breadcrumb of event.breadcrumbs ?? []) {
      for (const key of Object.keys(breadcrumb.data ?? {})) {
        if (/token|key|secret|password|credential|auth/i.test(key)) breadcrumb.data![key] = '[REDACTED]'
      }
    }
    return event
  },
})
Sentry.setUser({ id: createHash('sha256').update(hostname() + homedir()).digest('hex').slice(0, 16) })
registerThumbnailScheme()

let stopServer: (() => Promise<void>) | null = null
let windowManager: WindowManager | null = null
let browserPaneManager: BrowserPaneManager | null = null
let eventSink: ReturnType<WindowManager['getRpcEventSink']> = null
let resolveClientId: ((webContentsId: number) => string | undefined) | null = null
let pendingDeepLink: string | null = null
let isQuitting = false
let messagingBootstrap: ReturnType<typeof createMessagingBootstrap> | null = null

function findDeepLink(args: string[]): string | undefined {
  return args.find(argument => argument.startsWith('opcagent://'))
}

function registerProtocolHandler() {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('opcagent', process.execPath, [process.argv[1]])
    return
  }
  app.setAsDefaultProtocolClient('opcagent')
}

async function routeDeepLink(url: string) {
  if (!windowManager) {
    pendingDeepLink = url
    return
  }
  const result = await handleDeepLink(url, windowManager, eventSink ?? undefined, resolveClientId ?? undefined)
  if (!result.success) mainLog.warn('Unable to route deep link', { url, error: result.error })
}

function configureBundledTools() {
  const root = app.isPackaged ? join(process.resourcesPath, 'app') : process.cwd()
  const resources = app.isPackaged
    ? join(root, 'dist', 'resources')
    : join(root, 'apps', 'electron', 'resources')
  const platformKey = `${process.platform}-${process.arch}`
  const uvDir = join(resources, 'bin', platformKey)
  const binDir = join(resources, 'bin')
  const scriptsDir = join(resources, 'scripts')
  const uv = join(uvDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
  const bun = join(root, 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun')
  process.env.OPCAGENT_IS_PACKAGED = app.isPackaged ? '1' : '0'
  process.env.OPCAGENT_RESOURCES_BASE = root
  process.env.OPCAGENT_APP_ROOT = app.isPackaged ? app.getAppPath() : process.cwd()
  process.env.OPCAGENT_UV = existsSync(uv) ? uv : 'uv'
  if (existsSync(bun)) process.env.OPCAGENT_BUN = bun
  process.env.OPCAGENT_SCRIPTS = scriptsDir
  process.env.PATH = `${binDir}${delimiter}${uvDir}${delimiter}${process.env.PATH ?? ''}`
  setBundledAssetsRoot(app.isPackaged ? join(root, 'dist') : join(root, 'apps', 'electron'))
  initializeBackendHostRuntime({ hostRuntime: { appRootPath: process.env.OPCAGENT_APP_ROOT, resourcesPath: root, isPackaged: app.isPackaged } })
}

function ensureLocalWorkspace() {
  ensureDefaultWorkspace()
  if (getWorkspaces().length > 0) return
  addWorkspace({
    name: 'Default',
    rootPath: join(getDefaultWorkspacesDir(), 'default'),
    lastAccessedAt: Date.now(),
  })
}

async function start() {
  registerThumbnailHandler()
  configureBundledTools()
  initializeDocs()
  initializeReleaseNotes()
  ensureDefaultPermissions()
  ensureToolIcons()
  ensurePresetThemes()
  registerPiModelResolver(provider => provider ? getPiModelsForAuthProvider(provider) : getAllPiModels())

  windowManager = new WindowManager()
  createApplicationMenu(windowManager)
  browserPaneManager = new BrowserPaneManager()
  browserPaneManager.setWindowManager(windowManager)
  browserPaneManager.registerToolbarIpc()
  browserPaneManager.registerCapabilityIpc()

  const platform = createElectronPlatform({
    app,
    nativeImage,
    nativeTheme,
    shell,
    logger: mainLog,
    isDebugMode: !app.isPackaged,
    captureError: error => Sentry.captureException(error),
  })
  const clients = new Map<number, string>()
  const token = randomUUID()
  const instance = await bootstrapServer<SessionManager, HandlerDeps>({
    serverToken: token,
    rpcHost: '127.0.0.1',
    rpcPort: 0,
    serverId: 'desktop',
    serverVersion: app.getVersion(),
    bundledAssetsRoot: app.isPackaged ? app.getAppPath() : process.cwd(),
    platformFactory: () => platform,
    applyPlatformToSubsystems: current => {
      setFetcherPlatform(current)
      setSessionPlatform(current)
      setSessionRuntimeHooks({ captureException: error => Sentry.captureException(error) })
      setSearchPlatform(current)
      setImageProcessor(current.imageProcessor)
    },
    initModelRefreshService: () => initModelRefreshService(async slug => ({
      apiKey: await getCredentialManager().getLlmApiKey(slug).catch(() => null) ?? undefined,
    })),
    createSessionManager: () => {
      ensureLocalWorkspace()
      const manager = new SessionManager()
      manager.setBrowserPaneManager(browserPaneManager!)
      return manager
    },
    bindRpcServer: (manager, server) => manager.setRpcServer(server),
    createHandlerDeps: ({ sessionManager, platform: current, oauthFlowStore }) => {
      messagingBootstrap = createMessagingBootstrap({
        sessionManager,
        credentialManager: getCredentialManager(),
        getMessagingDir: workspaceId => join(
          getWorkspaces().find(workspace => workspace.id === workspaceId)?.rootPath ?? getDefaultWorkspacesDir(),
          'messaging',
        ),
        logger: mainLog,
        whatsapp: {
          workerEntry: app.isPackaged
            ? join(process.resourcesPath, 'messaging-whatsapp-worker', 'worker.cjs')
            : join(process.cwd(), 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs'),
          nodeBin: app.isPackaged ? process.execPath : 'node',
          electronRunAsNode: app.isPackaged,
        },
      })
      sessionManager.setAutomationBinder(async input => {
        await messagingBootstrap!.registry.bindAutomationTopic(input.workspaceId, input.topicName, input.sessionId)
      })
      return {
        sessionManager,
        platform: current,
        oauthFlowStore,
        windowManager: windowManager!,
        browserPaneManager: browserPaneManager!,
        messagingRegistry: messagingBootstrap.registry,
        onThemePreferencesChanged: preferences => browserPaneManager!.setThemeMode(preferences.mode),
      }
    },
    registerAllRpcHandlers,
    setSessionEventSink: (manager, sink) => manager.setEventSink(messagingBootstrap?.wrapSink(sink) ?? sink),
    initializeSessionManager: async manager => {
      await manager.initialize()
      for (const workspace of getWorkspaces()) manager.enableAutomationRuntime(workspace.id)
    },
    cleanupSessionManager: async manager => {
      await manager.flushAllSessions()
      manager.cleanup()
      await messagingBootstrap?.dispose()
      messagingBootstrap = null
    },
    onClientConnected: ({ clientId, webContentsId }) => {
      if (webContentsId !== null) clients.set(webContentsId, clientId)
    },
    cleanupClientResources: clientId => {
      cleanupSessionFileWatchForClient(clientId)
      for (const [webContentsId, id] of clients) if (id === clientId) clients.delete(webContentsId)
    },
  })
  stopServer = instance.stop
  const sink = instance.wsServer.push.bind(instance.wsServer)
  eventSink = sink
  messagingBootstrap?.setPublisher(sink)
  await messagingBootstrap?.initializeWorkspaces(getWorkspaces().map(workspace => workspace.id))
  resolveClientId = id => clients.get(id)
  windowManager.setRpcEventSink(sink, id => clients.get(id))
  setMenuEventSink(sink, id => clients.get(id))
  browserPaneManager.onStateChange(info => sink('browser-pane:state-changed', { to: 'all' }, info))
  browserPaneManager.onRemoved(id => sink('browser-pane:removed', { to: 'all' }, id))
  browserPaneManager.setSessionPathResolver(id => instance.sessionManager.getSessionPath(id))
  setAutoUpdateEventSink(sink)

  ipcMain.on('__get-web-contents-id', event => { event.returnValue = event.sender.id })
  ipcMain.on('__get-workspace-id', event => { event.returnValue = windowManager!.getWorkspaceForWindow(event.sender.id) ?? getWorkspaces()[0]!.id })
  ipcMain.on('__get-ws-port', event => { event.returnValue = instance.port })
  ipcMain.on('__get-ws-token', event => { event.returnValue = instance.token })
  ipcMain.handle('__dialog:showMessageBox', (event, options) => dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender)!, options))
  ipcMain.handle('__dialog:showOpenDialog', (event, options) => dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, options))
  ipcMain.handle('__i18n:changeLanguage', async (_event, language: unknown) => {
    if (typeof language === 'string' && SUPPORTED_LANGUAGE_CODES.includes(language as LanguageCode)) {
      await i18n.changeLanguage(language)
      setPersistedUiLanguage(language as LanguageCode)
      await rebuildMenu()
    }
  })

  const workspace = getWorkspaces()[0]!
  windowManager.createWindow({ workspaceId: workspace.id })
  if (pendingDeepLink) {
    const url = pendingDeepLink
    pendingDeepLink = null
    await routeDeepLink(url)
  }
  if (app.isPackaged) void checkForUpdatesOnLaunch()
}

registerProtocolHandler()
app.on('open-url', (event, url) => {
  event.preventDefault()
  void routeDeepLink(url)
})

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, commandLine) => {
    const url = findDeepLink(commandLine)
    if (url) void routeDeepLink(url)
    else windowManager?.getLastActiveWindow()?.focus()
  })
  app.whenReady().then(start).catch(error => {
    mainLog.error('Desktop startup failed', error)
    Sentry.captureException(error)
    app.quit()
  })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
    const workspace = getWorkspaces()[0]
    if (workspace) windowManager.createWindow({ workspaceId: workspace.id })
  }
})
app.on('before-quit', event => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  windowManager?.setAppQuitting(true)
  browserPaneManager?.destroyAll()
  void (async () => {
    try {
      await stopServer?.()
    } catch (error) {
      mainLog.error('Desktop shutdown failed', error)
      Sentry.captureException(error)
    } finally {
      app.quit()
    }
  })()
})
