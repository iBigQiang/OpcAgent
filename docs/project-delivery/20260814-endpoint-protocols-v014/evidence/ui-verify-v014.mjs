import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
const evidenceDir = resolve(import.meta.dirname)
const configDir = resolve(repoRoot, '.tmp', 'endpoint-protocol-v014-ui')
const workspaceDir = resolve(configDir, 'workspace')
const userDataDir = resolve(configDir, 'electron-user-data')
mkdirSync(workspaceDir, { recursive: true })

const now = Date.now()
writeFileSync(resolve(configDir, 'config.json'), JSON.stringify({
  workspaces: [{
    id: 'ui-verification',
    name: 'UI Verification',
    slug: 'ui-verification',
    rootPath: workspaceDir,
    createdAt: now,
    lastAccessedAt: now,
  }],
  activeWorkspaceId: 'ui-verification',
  activeSessionId: null,
  setupDeferred: true,
  llmConnections: [{
    slug: 'agentrouter-ui-verification',
    name: 'AgentRouter',
    providerType: 'pi_compat',
    baseUrl: 'https://agentrouter.org/v1',
    authType: 'api_key_with_endpoint',
    models: ['gpt-5.6-sol', 'claude-opus-5', 'claude-opus-4-8'],
    defaultModel: 'gpt-5.6-sol',
    modelSelectionMode: 'userDefined3Tier',
    piAuthProvider: 'openai',
    customEndpoint: { api: 'openai-completions' },
    platformProfile: 'agentrouter',
    createdAt: now,
  }],
  defaultLlmConnection: 'agentrouter-ui-verification',
}, null, 2))
writeFileSync(resolve(configDir, 'preferences.json'), JSON.stringify({ uiLanguage: 'zh-Hans' }, null, 2))

const packagedExecutable = process.env.OPCAGENT_UI_EXE?.trim()
const executable = packagedExecutable || resolve(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const launchTarget = packagedExecutable ? [] : ['apps/electron']
const child = spawn(executable, [
  '--remote-debugging-port=19214',
  '--remote-allow-origins=*',
  ...launchTarget,
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CONFIG_DIR: configDir,
    OPCAGENT_USER_DATA_DIR: userDataDir,
    OPCAGENT_DEV_RUNTIME: '1',
    OPCAGENT_AUTO_UPDATE_ENABLED: 'false',
    OPCAGENT_RPC_PORT: '0',
    OPCAGENT_HEALTH_PORT: '0',
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', chunk => { stdout += chunk.toString() })
child.stderr.on('data', chunk => { stderr += chunk.toString() })

let socket
let completed = false
async function cleanup() {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  if (child.exitCode === null) child.kill()
  if (child.exitCode === null) {
    await Promise.race([
      new Promise(resolvePromise => child.once('exit', resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, 3000)),
    ])
  }
  writeFileSync(resolve(evidenceDir, 'ui-electron-stdout.log'), stdout)
  writeFileSync(resolve(evidenceDir, 'ui-electron-stderr.log'), stderr)
}

process.on('exit', () => {
  if (!completed && child.exitCode === null) child.kill()
})

try {

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function openDevToolsProtocol() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) return match[1]
    if (child.exitCode !== null) throw new Error(`Electron exited before DevTools was available (${child.exitCode})`)
    await sleep(250)
  }
  throw new Error('Timed out waiting for Electron DevTools endpoint')
}

const browserWs = await openDevToolsProtocol()
const targetsUrl = browserWs.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '/json/list')
let targets = []
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    targets = await fetch(targetsUrl).then(response => response.json())
    if (targets.some(target => target.type === 'page' && target.webSocketDebuggerUrl)) break
  } catch {
    // Renderer can take a few seconds to initialize.
  }
  await sleep(250)
}
const pageTarget = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
if (!pageTarget) throw new Error('No Electron renderer DevTools target found')

socket = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((resolvePromise, reject) => {
  socket.addEventListener('open', resolvePromise, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})

function cdp(method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    const id = nextId++
    pending.set(id, { resolve: resolvePromise, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, awaitPromise = true) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(expression)) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function screenshot(name) {
  const image = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(evidenceDir, name), Buffer.from(image.data, 'base64'))
}

async function clickPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Clickable element coordinates were not found')
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

await cdp('Runtime.enable')
await cdp('Page.enable')
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
await waitFor('document.readyState === "complete" && document.body.innerText.length > 0', 'renderer content')

await evaluate(`window.dispatchEvent(new CustomEvent('craft-agent-navigate', { detail: { route: 'settings/ai' }, bubbles: true }))`)
await waitFor(`document.body.innerText.includes('AgentRouter')`, 'AgentRouter settings row')
const summaryText = await evaluate(`document.body.innerText`)
if (!summaryText.includes('OpenAI Chat Completions')) throw new Error('AgentRouter protocol is missing from the settings summary')
await screenshot('ui-agentrouter-summary.png')

const connectionMenuPoint = await evaluate(`(() => {
  const description = [...document.querySelectorAll('*')].find(element =>
    element.childElementCount === 0
      && element.textContent?.includes('OpenAI Chat Completions')
      && element.textContent?.includes('agentrouter.org')
  )
  let row = description?.parentElement
  while (row && row !== document.body && !row.querySelector('button[data-state]')) row = row.parentElement
  const button = row?.querySelector('button[data-state]')
  if (!button) throw new Error('AgentRouter action menu not found')
  const rect = button.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
await clickPoint(connectionMenuPoint)
await waitFor(`Boolean(document.querySelector('[role="menu"]'))`, 'AgentRouter action menu')
await screenshot('ui-agentrouter-action-menu.png')
const editPoint = await evaluate(`(() => {
  const menu = document.querySelector('[role="menu"]')
  const item = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find(element => element.textContent?.trim() === '编辑')
  if (!item) throw new Error('Edit action not found')
  const rect = item.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
await clickPoint(editPoint)
await sleep(1000)
writeFileSync(resolve(evidenceDir, 'ui-after-edit-click.txt'), await evaluate(`document.body.innerText`))
await waitFor(`document.body.innerText.includes('协议') && document.body.innerText.includes('实际请求地址')`, 'endpoint protocol editor')

const editorText = await evaluate(`document.body.innerText`)
const editorValues = await evaluate(`(() => [...document.querySelectorAll('input')].map(input => input.value))()`)
for (const expected of [
  'https://agentrouter.org/v1',
  'https://agentrouter.org/v1/chat/completions',
  'OpenAI Chat Completions',
]) {
  if (!editorText.includes(expected)) throw new Error(`Missing editor text: ${expected}`)
}
if (!editorValues.some(value => value.includes('gpt-5.6-sol'))) throw new Error('Missing hydrated gpt-5.6-sol model value')
await screenshot('ui-agentrouter-editor.png')

const protocolPoint = await evaluate(`(() => {
  const label = [...document.querySelectorAll('label')].find(element => element.textContent?.trim() === '协议')
  let container = label?.parentElement
  while (container && container !== document.body && !container.querySelector('button')) container = container.parentElement
  const trigger = container?.querySelector('button')
  if (!trigger) throw new Error('Protocol dropdown trigger not found')
  const rect = trigger.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
await clickPoint(protocolPoint)
await waitFor(`document.body.innerText.includes('OpenAI Responses') && document.body.innerText.includes('Anthropic Messages') && document.body.innerText.includes('Google Gemini')`, 'four protocol choices')
await screenshot('ui-protocol-dropdown.png')

const responsesPoint = await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => element.textContent?.includes('OpenAI Responses') && element.textContent?.includes('/responses'))
  if (!item) throw new Error('OpenAI Responses menu item not found')
  const rect = item.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
await clickPoint(responsesPoint)
await waitFor(`document.body.innerText.includes('https://agentrouter.org/v1/responses')`, 'Responses request preview')
const responsesText = await evaluate(`document.body.innerText`)
if (responsesText.includes('/chat/completions/responses')) throw new Error('Protocol switching duplicated request paths')
await screenshot('ui-openai-responses-preview.png')

writeFileSync(resolve(evidenceDir, 'ui-verification-result.json'), JSON.stringify({
  status: 'passed',
  executable: packagedExecutable ? 'packaged OPC Agent 0.1.4' : 'development Electron runtime',
  browserWs: browserWs.replace(/\/devtools\/browser\/.+$/, '/devtools/browser/<redacted>'),
  assertions: [
    'AgentRouter settings summary shows OpenAI Chat Completions',
    'AgentRouter editor hydrates gpt-5.6-sol and https://agentrouter.org/v1',
    'OpenAI Chat request preview is https://agentrouter.org/v1/chat/completions',
    'Protocol dropdown shows all four supported protocols',
    'Switching to OpenAI Responses previews https://agentrouter.org/v1/responses without duplication',
  ],
}, null, 2))

completed = true
await cleanup()
console.log('Electron UI verification passed')
} catch (error) {
  await cleanup()
  throw error
}
