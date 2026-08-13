/**
 * Five-field cron matching without a runtime dependency.
 *
 * Scheduler ticks are minute-aligned, so this deliberately supports only the
 * conventional minute/hour/day-of-month/month/day-of-week format. Invalid
 * expressions fail closed instead of being treated as a wildcard.
 */

type CronField = { min: number; max: number; values: Set<number> }

function parseNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function parseField(source: string, min: number, max: number, normalize?: (value: number) => number): CronField | null {
  const values = new Set<number>()
  for (const part of source.split(',')) {
    const [rangeSource, stepSource] = part.split('/')
    if (part.split('/').length > 2 || !rangeSource) return null
    const step = stepSource === undefined ? 1 : parseNumber(stepSource, 1, max - min + 1)
    if (step === null) return null

    let start = min
    let end = max
    if (rangeSource !== '*') {
      const range = rangeSource.split('-')
      if (range.length === 1) {
        const value = parseNumber(range[0]!, min, max)
        if (value === null) return null
        start = value
        end = value
      } else if (range.length === 2) {
        const first = parseNumber(range[0]!, min, max)
        const last = parseNumber(range[1]!, min, max)
        if (first === null || last === null || first > last) return null
        start = first
        end = last
      } else {
        return null
      }
    }
    for (let value = start; value <= end; value += step) values.add(normalize ? normalize(value) : value)
  }
  return { min, max, values }
}

interface ParsedCron { minute: CronField; hour: CronField; dayOfMonth: CronField; month: CronField; dayOfWeek: CronField }

function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseField(fields[0]!, 0, 59)
  const hour = parseField(fields[1]!, 0, 23)
  const dayOfMonth = parseField(fields[2]!, 1, 31)
  const month = parseField(fields[3]!, 1, 12)
  const dayOfWeek = parseField(fields[4]!, 0, 7, value => value === 7 ? 0 : value)
  return minute && hour && dayOfMonth && month && dayOfWeek ? { minute, hour, dayOfMonth, month, dayOfWeek } : null
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null
}

function zonedParts(date: Date, timezone?: string): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } | null {
  try {
    if (!timezone) return { minute: date.getMinutes(), hour: date.getHours(), dayOfMonth: date.getDate(), month: date.getMonth() + 1, dayOfWeek: date.getDay() }
    const values = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
    }).formatToParts(date)
    const part = (type: string) => values.find(value => value.type === type)?.value
    const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const weekday = part('weekday')
    const minute = Number(part('minute'))
    const hour = Number(part('hour'))
    const dayOfMonth = Number(part('day'))
    const month = Number(part('month'))
    return weekday !== undefined && weekday in weekdays && [minute, hour, dayOfMonth, month].every(Number.isInteger)
      ? { minute, hour, dayOfMonth, month, dayOfWeek: weekdays[weekday]! }
      : null
  } catch {
    return null
  }
}

/** Check whether the supplied (or current) minute matches a five-field cron expression. */
export function matchesCron(cronExpr: string, timezone?: string, now = new Date()): boolean {
  const cron = parseCron(cronExpr)
  const time = zonedParts(now, timezone)
  return cron !== null && time !== null
    && cron.minute.values.has(time.minute)
    && cron.hour.values.has(time.hour)
    && cron.dayOfMonth.values.has(time.dayOfMonth)
    && cron.month.values.has(time.month)
    && cron.dayOfWeek.values.has(time.dayOfWeek)
}
