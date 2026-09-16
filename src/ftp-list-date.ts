const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** LIST's wall-clock date is only a sorting hint, never an authoritative timestamp. */
export function ftpListDateSortValue(text: string | undefined, now: number): number {
  const match = /^([a-z]{3})\s+(\d{1,2})\s+(?:(\d{4})|(\d{1,2}):(\d{2})(?::(\d{2}))?)$/i.exec(text?.trim() ?? '')
  if (!match) return 0
  const month = MONTHS.indexOf(match[1]!.toLowerCase())
  const day = Number(match[2]), hour = Number(match[4] ?? 0), minute = Number(match[5] ?? 0), second = Number(match[6] ?? 0)
  let year = Number(match[3] ?? new Date(now).getUTCFullYear())
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return 0
  let value = Date.UTC(year, month, day, hour, minute, second)
  // Recent UNIX listings omit the year. Account for December at a January
  // boundary; allow clock/timezone skew without moving today's entry a year.
  if (!match[3] && value > now + 36 * 60 * 60 * 1000) value = Date.UTC(--year, month, day, hour, minute, second)
  const date = new Date(value)
  return date.getUTCMonth() === month && date.getUTCDate() === day ? value : 0
}
