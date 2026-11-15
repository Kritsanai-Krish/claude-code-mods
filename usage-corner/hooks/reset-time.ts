// `/usage` prints resets as wall-clock text in the account's time zone
// (`Nov 17, 10pm (Asia/Bangkok)`). The corner needs clock milliseconds to
// count down, so this turns that text back into a moment.

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// `Nov 17, 10pm`, `Nov 15, 10:50pm`, `Nov 17 at 9am`, or a time alone: `10:50pm`.
const RESET_PATTERN = /^(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i
const MILLISECONDS_PER_SECOND = 1000
const HOURS_ON_A_CLOCK_FACE = 12
const LAST_MINUTE = 59
const LAST_DAY_OF_MONTH = 31

type WallTime = { year: number; monthIndex: number; day: number; hour: number; minute: number }

/** Reads a moment as the wall clock of `timeZone` shows it, or undefined for a zone the runtime does not know. */
function readWallTime(milliseconds: number, timeZone: string): (WallTime & { second: number }) | undefined {
  let parts: Intl.DateTimeFormatPart[]
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    parts = formatter.formatToParts(new Date(milliseconds))
  } catch {
    // An unknown zone name throws a RangeError.
    return undefined
  }
  const read = (type: string): number => Number(parts.find(part => part.type === type)?.value)
  const wallTime = {
    year: read('year'), monthIndex: read('month') - 1, day: read('day'),
    hour: read('hour'), minute: read('minute'), second: read('second'),
  }
  return Object.values(wallTime).some(Number.isNaN) ? undefined : wallTime
}

/** How far the zone's wall clock is ahead of UTC at that moment, in milliseconds. */
function zoneOffsetAt(milliseconds: number, timeZone: string): number | undefined {
  const wall = readWallTime(milliseconds, timeZone)
  if (wall === undefined) {
    return undefined
  }
  const wallAsUtc = Date.UTC(wall.year, wall.monthIndex, wall.day, wall.hour, wall.minute, wall.second)
  const wholeSeconds = Math.floor(milliseconds / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND
  return wallAsUtc - wholeSeconds
}

/** Turns a wall-clock time in `timeZone` into clock milliseconds. */
function wallTimeToMilliseconds(wall: WallTime, timeZone: string): number | undefined {
  const wallAsUtc = Date.UTC(wall.year, wall.monthIndex, wall.day, wall.hour, wall.minute)
  const firstOffset = zoneOffsetAt(wallAsUtc, timeZone)
  if (firstOffset === undefined) {
    return undefined
  }
  // The offset was read at a moment up to a day off; near a daylight-saving
  // switch it can differ at the real moment, so read it once more there.
  const secondOffset = zoneOffsetAt(wallAsUtc - firstOffset, timeZone)
  return wallAsUtc - (secondOffset ?? firstOffset)
}

/** The candidate closest to now: a date without a year is this year's, or next year's across New Year. */
function closestToNow(candidates: readonly (number | undefined)[], nowMilliseconds: number): number | undefined {
  let closest: number | undefined
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue
    }
    if (closest === undefined || Math.abs(candidate - nowMilliseconds) < Math.abs(closest - nowMilliseconds)) {
      closest = candidate
    }
  }
  return closest
}

/**
 * Parses a reset time as `/usage` prints it (`Nov 17, 10pm`, `10:50pm`) in
 * the named time zone. Returns clock milliseconds, or undefined when the text
 * has another form or the zone is unknown, so the caller can show the text.
 */
export function parseResetText(resetText: string, timeZone: string | undefined, nowMilliseconds: number): number | undefined {
  const match = RESET_PATTERN.exec(resetText.trim())
  if (match === null || timeZone === undefined) {
    return undefined
  }
  const [, monthName, dayText, hourText, minuteText, meridiem] = match
  const hourOnFace = Number(hourText)
  const minute = minuteText === undefined ? 0 : Number(minuteText)
  if (hourOnFace < 1 || hourOnFace > HOURS_ON_A_CLOCK_FACE || minute > LAST_MINUTE) {
    return undefined
  }
  const isAfternoon = meridiem?.toLowerCase() === 'pm'
  const hour = (hourOnFace % HOURS_ON_A_CLOCK_FACE) + (isAfternoon ? HOURS_ON_A_CLOCK_FACE : 0)
  const today = readWallTime(nowMilliseconds, timeZone)
  if (today === undefined) {
    return undefined
  }

  if (monthName === undefined) {
    // A time alone is the next time the clock shows it: today, or tomorrow when already past.
    const laterToday = wallTimeToMilliseconds({ ...today, hour, minute }, timeZone)
    if (laterToday === undefined || laterToday >= nowMilliseconds) {
      return laterToday
    }
    return wallTimeToMilliseconds({ ...today, day: today.day + 1, hour, minute }, timeZone)
  }

  const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase())
  const day = Number(dayText)
  if (monthIndex === -1 || day < 1 || day > LAST_DAY_OF_MONTH) {
    return undefined
  }
  const candidates = [today.year - 1, today.year, today.year + 1].map(year =>
    wallTimeToMilliseconds({ year, monthIndex, day, hour, minute }, timeZone),
  )
  return closestToNow(candidates, nowMilliseconds)
}

/** True when two reset times are the same period: the API's and `/usage`'s can differ by a few minutes. */
export function isSameResetMoment(first: number, second: number): boolean {
  const TOLERANCE_MILLISECONDS = 30 * 60 * 1000
  return Math.abs(first - second) < TOLERANCE_MILLISECONDS
}
