/**
 * Shared automation utilities.
 *
 * Cron helpers used by CronBuilder (visual editor) and AutomationInfoPage (info display).
 * Time formatting shared by AutomationsListPanel and AutomationEventTimeline.
 */

import { isValidCron, matchesCron } from '@opcagent/shared/automations/cron-matcher'

/**
 * Format a timestamp as a compact relative time string (e.g. "3m", "2h", "5d").
 * Used by both AutomationsListPanel (trailing timestamp) and AutomationEventTimeline.
 */
export function formatShortRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

/**
 * Describe a cron expression in human-readable form.
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return 'Invalid schedule'

  const [minute, hour, dom, month, dow] = parts

  if (cron.trim() === '* * * * *') return 'Every minute'
  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`
  if (hour === '*' && minute !== '*') return `Every hour at :${minute.padStart(2, '0')}`
  if (dom === '*' && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (dow === '*') return `Daily at ${time}`
    if (dow === '1-5') return `Weekdays at ${time}`
    if (dow === '0,6') return `Weekends at ${time}`
    return `At ${time} (weekday: ${dow})`
  }
  if (month === '*' && dow === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    return `Monthly on day ${dom} at ${time}`
  }
  return cron
}

/**
 * Compute the next N run times with the same five-field matcher used by the
 * scheduler. The UI only previews a bounded horizon and never creates timers.
 */
export function computeNextRuns(cron: string, count: number = 3): Date[] {
  if (!isValidCron(cron) || count <= 0) return []

  const runs: Date[] = []
  const cursor = new Date()
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const maxMinutes = 366 * 24 * 60

  for (let i = 0; i < maxMinutes && runs.length < count; i++) {
    if (matchesCron(cron, undefined, cursor)) runs.push(new Date(cursor))
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return runs
}
