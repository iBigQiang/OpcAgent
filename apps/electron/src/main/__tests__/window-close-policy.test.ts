import { beforeAll, describe, expect, it, mock } from 'bun:test'

mock.module('electron', () => ({
  BrowserWindow: class {},
  shell: {},
  nativeTheme: {},
  Menu: {},
  app: {
    isPackaged: false,
    isReady: () => false,
    once: () => {},
    on: () => {},
    off: () => {},
    getPath: () => undefined,
    getName: () => 'OPC Agent',
    getVersion: () => '0.1.8',
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
  },
}))
mock.module('../auto-update', () => ({ isUpdating: () => false }))

let isNativeTitlebarCloseHit: typeof import('../window-manager').isNativeTitlebarCloseHit
let shouldMinimizeWindowClose: typeof import('../window-manager').shouldMinimizeWindowClose

beforeAll(async () => {
  const module = await import('../window-manager')
  isNativeTitlebarCloseHit = module.isNativeTitlebarCloseHit
  shouldMinimizeWindowClose = module.shouldMinimizeWindowClose
})

describe('Windows main-window close policy', () => {
  it('recognizes only the Windows native title-bar close hit', () => {
    const closeHit = Buffer.alloc(8)
    closeHit.writeUInt32LE(20)
    const captionHit = Buffer.alloc(8)
    captionHit.writeUInt32LE(2)

    expect(isNativeTitlebarCloseHit('win32', closeHit)).toBe(true)
    expect(isNativeTitlebarCloseHit('win32', captionHit)).toBe(false)
    expect(isNativeTitlebarCloseHit('darwin', closeHit)).toBe(false)
    expect(isNativeTitlebarCloseHit('win32', Buffer.alloc(0))).toBe(false)
  })

  it('minimizes only a confirmed Windows title-bar X request', () => {
    expect(shouldMinimizeWindowClose('win32', 'window-button', true)).toBe(true)
    expect(shouldMinimizeWindowClose('win32', 'window-button', false)).toBe(false)
    expect(shouldMinimizeWindowClose('win32', 'keyboard-shortcut', true)).toBe(false)
    expect(shouldMinimizeWindowClose('win32', 'unknown', true)).toBe(false)
    expect(shouldMinimizeWindowClose('darwin', 'window-button', true)).toBe(false)
    expect(shouldMinimizeWindowClose('linux', 'window-button', true)).toBe(false)
  })
})
