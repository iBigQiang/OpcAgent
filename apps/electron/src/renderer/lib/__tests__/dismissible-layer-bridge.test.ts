import { afterEach, describe, expect, it } from 'bun:test'
import {
  getDismissibleLayerBridge as getUiDismissibleLayerBridge,
  setDismissibleLayerBridge as setUiDismissibleLayerBridge,
} from '../../../../../../packages/ui/src/lib/dismissible-layer-bridge'
import {
  getDismissibleLayerBridge,
  setDismissibleLayerBridge,
  type DismissibleLayerBridge,
} from '../dismissible-layer-bridge'

const bridge: DismissibleLayerBridge = {
  registerLayer: () => () => {},
  hasOpenLayers: () => false,
  getTopLayer: () => null,
  closeTop: () => false,
  handleEscape: () => false,
}

afterEach(() => {
  setDismissibleLayerBridge(null)
  setUiDismissibleLayerBridge(null)
})

describe('dismissible layer bridge', () => {
  it('shares the bridge with fullscreen UI overlays', () => {
    setDismissibleLayerBridge(bridge)

    expect(getDismissibleLayerBridge()).toBe(bridge)
    expect(getUiDismissibleLayerBridge()).toBe(bridge)
  })
})
