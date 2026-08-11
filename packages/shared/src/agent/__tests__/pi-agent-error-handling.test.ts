import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/mkagent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/mkagent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent subprocess error handling', () => {
  it('maps raw HTML subprocess errors to typed proxy_error events', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
    }))

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].type).toBe('typed_error')
    expect(enqueued[0].error.code).toBe('proxy_error')
    expect(enqueued[0].error.message.toLowerCase()).not.toContain('<html')

    agent.destroy()
  })

  it('does not enqueue chat errors for mini_completion_error messages', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    let rejectedMessage = ''
    ;(agent as any).pendingMiniCompletions.set('mini-1', {
      resolve: () => {},
      reject: (error: Error) => {
        rejectedMessage = error.message
      },
    })

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      code: 'mini_completion_error',
      message: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
    }))

    expect(enqueued).toHaveLength(0)
    expect((agent as any).pendingMiniCompletions.size).toBe(0)
    expect(rejectedMessage).toContain('400 Bad Request')

    agent.destroy()
  })

  it('suppresses only identical consecutive subprocess errors', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    for (let i = 0; i < 4; i++) {
      ;(agent as any).handleLine(JSON.stringify({
        type: 'error',
        message: 'EFAULT: broken pipe',
      }))
    }

    expect(enqueued).toHaveLength(3)
    expect(enqueued.every((event) => event.type === 'error' || event.type === 'typed_error')).toBe(true)

    agent.destroy()
  })

  it('resets repeated subprocess error suppression after non-error traffic', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    for (let i = 0; i < 3; i++) {
      ;(agent as any).handleLine(JSON.stringify({
        type: 'error',
        message: 'EFAULT: broken pipe',
      }))
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'event',
      event: { type: 'agent_message_delta', delta: 'ok' },
    }))

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: 'EFAULT: broken pipe',
    }))

    expect(enqueued.filter((event) => event.type === 'error' || event.type === 'typed_error')).toHaveLength(4)

    agent.destroy()
  })

  it('rejects startup readiness when the subprocess exits before ready', async () => {
    const agent = new PiAgent(createConfig())
    const ready = new Promise<void>((resolve, reject) => {
      ;(agent as any).subprocessReadyResolve = resolve
      ;(agent as any).subprocessReadyReject = reject
    })
    ;(agent as any).subprocessReady = ready

    ;(agent as any).handleSubprocessExit(1, null)

    const outcome = await Promise.race([
      ready.then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      Bun.sleep(100).then(() => 'pending'),
    ])

    expect(outcome).toBe('Pi subprocess exited unexpectedly (code 1)')
    agent.destroy()
  })

  it('clears rejected startup state so a later attempt can retry', async () => {
    const agent = new PiAgent(createConfig())
    const ready = new Promise<void>((resolve, reject) => {
      ;(agent as any).subprocessReadyResolve = resolve
      ;(agent as any).subprocessReadyReject = reject
    })
    ;(agent as any).subprocessReady = ready
    ;(agent as any).subprocess = { stdin: { writable: false } }

    ;(agent as any).handleSubprocessError(new Error('startup failed'))

    const outcome = await ready.then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    expect(outcome).toBe('Pi subprocess failed to start: startup failed')
    expect((agent as any).subprocess).toBeNull()
    expect((agent as any).subprocessReady).toBeNull()
    expect((agent as any).subprocessReadyResolve).toBeNull()
    expect((agent as any).subprocessReadyReject).toBeNull()
    agent.destroy()
  })

  it('rejects startup readiness when the subprocess is stopped explicitly', async () => {
    const agent = new PiAgent(createConfig())
    const ready = new Promise<void>((resolve, reject) => {
      ;(agent as any).subprocessReadyResolve = resolve
      ;(agent as any).subprocessReadyReject = reject
    })
    ;(agent as any).subprocessReady = ready
    ;(agent as any).subprocess = {
      stdin: { writable: true, write: () => true },
      kill: () => true,
    }

    ;(agent as any).killSubprocess()

    const outcome = await ready.then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    expect(outcome).toBe('Pi subprocess stopped before ready.')
    expect((agent as any).subprocess).toBeNull()
    agent.destroy()
  })
})
