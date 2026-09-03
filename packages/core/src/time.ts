/**
 * core/time.ts — local intent <-> UTC instant, per store timezone.
 *
 * A pickup window is authored as "21:00–22:00 on 3 Sep" in the STORE's
 * timezone and resolved to UTC. Both are persisted: the instants are what the
 * system acts on, the local intent is what the partner meant and what the DST
 * integrity job re-validates against (docs/CLAUDE.md §7, §8).
 *
 * DECISION D11: timezone maths is done with Intl.DateTimeFormat rather than a
 * date library. Adding luxon or date-fns-tz would still delegate to Intl for
 * IANA rules, so the dependency buys nothing but bundle size on a mobile app
 * whose cold-start budget is 3s on a mid-range Android over 3G.
 */
import type { Market } from './types';
import { AppError } from './types';

export const TIMEZONE: Record<Market, string> = { KW: 'Asia/Kuwait', EG: 'Africa/Cairo' };
export const OBSERVES_DST: Record<Market, boolean> = { KW: false, EG: true };

export interface LocalWindowIntent {
  localDate: string;   // YYYY-MM-DD, in `timezone`
  localStart: string;  // HH:mm
  localEnd: string;    // HH:mm
  timezone: string;    // IANA, from store.timezone
}

export interface ResolvedWindow {
  startUtc: Date;
  endUtc: Date;
  abbreviation: string;
  intent: LocalWindowIntent;
}

export type WindowState = 'not_open' | 'open' | 'closing_soon' | 'closed' | 'expired';

export interface DstResolution {
  ok: boolean;
  problem?: 'non_existent' | 'ambiguous';
  suggestedStart?: string;
  suggestedEnd?: string;
}

export interface ZonedParts {
  year: string; month: string; day: string; hour: string; minute: string; second: string;
}

const PART_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = PART_CACHE.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    PART_CACHE.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading in `timeZone` for a given UTC instant. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // Intl renders midnight as hour "24" in some engines; normalise it.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour, minute: get('minute'), second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export function offsetMs(instant: Date, timeZone: string): number {
  const p = utcToZonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  // Second-resolution comparison: Intl gives no milliseconds.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function localFieldsToUtcGuess(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if ([y, m, d, hh, mm].some((n) => n === undefined || Number.isNaN(n))) {
    throw new AppError('time.malformed_local', { date, time });
  }
  return Date.UTC(y as number, (m as number) - 1, d as number, hh as number, mm as number, 0);
}

function rendersAs(instant: Date, timeZone: string, date: string, time: string): boolean {
  const p = utcToZonedParts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
}

/**
 * Local wall-clock time in `timeZone` -> UTC instant.
 *
 * Two passes: guess with the offset in force at the naive instant, then
 * re-derive with the offset actually in force at the candidate. That second
 * pass is what makes the conversion correct across a transition.
 *
 * Returns every instant that renders as the requested local time: zero for a
 * skipped (spring-forward) time, two for a repeated (fall-back) one. Callers
 * that need a single answer use zonedTimeToUtc.
 */
export function zonedTimeCandidates(date: string, time: string, timeZone: string): Date[] {
  const naive = localFieldsToUtcGuess(date, time);
  const seen = new Map<number, Date>();
  for (const probe of [naive - 86_400_000, naive, naive + 86_400_000]) {
    const off = offsetMs(new Date(probe), timeZone);
    const candidate = new Date(naive - off);
    if (rendersAs(candidate, timeZone, date, time)) seen.set(candidate.getTime(), candidate);
  }
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * The single UTC instant for a local time. On an ambiguous (repeated) local
 * time the EARLIER instant is chosen, so a pickup window never silently gains
 * an hour. On a skipped local time this raises: the partner must be offered a
 * concrete replacement rather than have the window moved for them (§13-7).
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const candidates = zonedTimeCandidates(date, time, timeZone);
  const first = candidates[0];
  if (!first) throw new AppError('time.non_existent_local', { date, time, timeZone });
  return first;
}

/** Kuwait is AST year-round. Egypt is EET or EEST, resolved from the instant. */
export function tzAbbreviation(instant: Date, market: Market): string {
  if (market === 'KW') return 'AST';
  return offsetMs(instant, TIMEZONE.EG) === 3 * 3600_000 ? 'EEST' : 'EET';
}

/**
 * Longest window we will read as "overnight". A bakery authoring 23:00–00:30
 * is real; 22:00–21:00 is a typo for which rolling to the next day would
 * silently create a 23-hour window. Past this bound we raise instead of
 * guessing, in the spirit of §13-4: never silently clamp, name the problem.
 * DECISION D12.
 */
export const MAX_WINDOW_HOURS = 12;

export function resolveWindow(intent: LocalWindowIntent): ResolvedWindow {
  const startUtc = zonedTimeToUtc(intent.localDate, intent.localStart, intent.timezone);
  let endUtc = zonedTimeToUtc(intent.localDate, intent.localEnd, intent.timezone);
  // A window authored past midnight (23:00–00:30) ends on the next day.
  if (endUtc.getTime() <= startUtc.getTime()) {
    const nextDay = new Date(Date.parse(`${intent.localDate}T00:00:00Z`) + 86_400_000)
      .toISOString().slice(0, 10);
    endUtc = zonedTimeToUtc(nextDay, intent.localEnd, intent.timezone);
  }
  if (endUtc.getTime() <= startUtc.getTime()) {
    throw new AppError('time.window_not_positive', { intent });
  }
  const hours = (endUtc.getTime() - startUtc.getTime()) / 3600_000;
  if (hours > MAX_WINDOW_HOURS) {
    throw new AppError('time.window_too_long', { intent, hours, max: MAX_WINDOW_HOURS });
  }
  const market: Market = intent.timezone === TIMEZONE.EG ? 'EG' : 'KW';
  return { startUtc, endUtc, abbreviation: tzAbbreviation(startUtc, market), intent };
}

/**
 * Does this authored window survive the timezone's DST rules?
 *
 * Never repairs the window silently — it reports the problem and suggests a
 * concrete replacement the partner can accept or reject (§13-7).
 */
export function checkDst(intent: LocalWindowIntent): DstResolution {
  for (const [field, time] of [['start', intent.localStart], ['end', intent.localEnd]] as const) {
    const candidates = zonedTimeCandidates(intent.localDate, time as string, intent.timezone);
    if (candidates.length === 0) {
      // Skipped hour: the same wall-clock reading one hour later does exist.
      const shifted = shiftHour(time as string, 1);
      return {
        ok: false,
        problem: 'non_existent',
        suggestedStart: field === 'start' ? shifted : intent.localStart,
        suggestedEnd: field === 'end' ? shifted : shiftHour(intent.localEnd, 1),
      };
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        problem: 'ambiguous',
        suggestedStart: field === 'start' ? shiftHour(time as string, 1) : intent.localStart,
        suggestedEnd: intent.localEnd,
      };
    }
  }
  return { ok: true };
}

function shiftHour(time: string, by: number): string {
  const [hh, mm] = time.split(':').map(Number);
  const h = (((hh as number) + by) % 24 + 24) % 24;
  return `${String(h).padStart(2, '0')}:${String(mm as number).padStart(2, '0')}`;
}

/**
 * Every local time in `year` that a DST transition makes impossible or
 * ambiguous in `timeZone`. This is what dst_integrity_check runs against every
 * future materialised listing before a transition (08-jobs.md).
 */
export function scanDstProblems(
  timeZone: string,
  year: number,
): Array<{ localDate: string; localTime: string; problem: 'non_existent' | 'ambiguous' }> {
  const out: Array<{ localDate: string; localTime: string; problem: 'non_existent' | 'ambiguous' }> = [];
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const HOUR = 3600_000;

  let prev = offsetMs(new Date(yearStart), timeZone);
  for (let t = yearStart; t < yearEnd; t += HOUR) {
    const off = offsetMs(new Date(t), timeZone);
    if (off === prev) continue;

    const delta = Math.abs(off - prev);
    // The wall clock reading at the transition instant, as a naive UTC value so
    // we can do plain arithmetic on it without re-entering the timezone.
    const p = utcToZonedParts(new Date(t), timeZone);
    const naive = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), 0,
    );

    // Spring forward: the clock jumped from (naive - delta) to naive, so every
    // local time in between never happens. Fall back: it repeated naive
    // .. naive + delta, so each of those readings is ambiguous.
    const problem = off > prev ? 'non_existent' : 'ambiguous';
    for (let m = HOUR; m <= delta; m += HOUR) {
      const probe = new Date(problem === 'non_existent' ? naive - m : naive + (m - HOUR));
      const localDate = probe.toISOString().slice(0, 10);
      const localTime = probe.toISOString().slice(11, 16);
      const candidates = zonedTimeCandidates(localDate, localTime, timeZone);
      const confirmed = problem === 'non_existent' ? candidates.length === 0 : candidates.length > 1;
      if (confirmed) out.push({ localDate, localTime, problem });
    }
    prev = off;
  }
  return out;
}

export function windowState(
  now: Date, startUtc: Date, endUtc: Date, graceMinutes: number,
): WindowState {
  const t = now.getTime();
  if (t < startUtc.getTime()) return 'not_open';
  const closingSoonFrom = endUtc.getTime() - 30 * 60_000;
  if (t < closingSoonFrom) return 'open';
  if (t < endUtc.getTime()) return 'closing_soon';
  if (t < endUtc.getTime() + graceMinutes * 60_000) return 'closed';
  return 'expired';
}
