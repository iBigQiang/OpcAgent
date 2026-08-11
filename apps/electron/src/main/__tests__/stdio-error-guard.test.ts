import { describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { installStdioEpipeGuard } from '../stdio-error-guard'

describe('installStdioEpipeGuard', () => {
  it('suppresses EPIPE and disables console logging', () => {
    const stream = new EventEmitter()
    const onEpipe = mock(() => {})
    installStdioEpipeGuard(stream, onEpipe)

    const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
    expect(() => stream.emit('error', error)).not.toThrow()
    expect(onEpipe).toHaveBeenCalledTimes(1)
  })

  it('does not hide non-EPIPE stream errors', () => {
    const stream = new EventEmitter()
    installStdioEpipeGuard(stream, () => {})

    const error = Object.assign(new Error('I/O failure'), { code: 'EIO' })
    expect(() => stream.emit('error', error)).toThrow(error)
  })
})
