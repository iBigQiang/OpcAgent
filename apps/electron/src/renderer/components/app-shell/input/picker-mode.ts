/** 两种选择器共用显示规则；已有历史及已删除原渠道都不能隐藏恢复入口。 */

export type PickerMode = 'unavailable' | 'switcher' | 'locked-single' | 'flat'

export interface PickerModeInput {
  connectionUnavailable: boolean
  /** Non-null when the active connection is `pi_compat` with ≤1 model. */
  connectionDefaultModel: string | null
  /** Total number of configured connections in the workspace. */
  connectionCount: number
}

export function derivePickerMode(input: PickerModeInput): PickerMode {
  if (input.connectionCount > 1 || (input.connectionUnavailable && input.connectionCount > 0)) return 'switcher'
  if (input.connectionUnavailable) return 'unavailable'
  if (input.connectionDefaultModel != null) return 'locked-single'
  return 'flat'
}
