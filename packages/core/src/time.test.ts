import { describe, it, expect } from 'vitest';
import {
  TIMEZONE, OBSERVES_DST, offsetMs, zonedTimeToUtc, utcToZonedParts,
  resolveWindow, checkDst, windowState, tzAbbreviation, scanDstProblems,
} from './time';

const KW = TIMEZONE.KW;   // Asia/Kuwait — UTC+3, no DST
const EG = TIMEZONE.EG;   // Africa/Cairo — UTC+2, DST observed

describe('offsets', () => {
  it('Kuwait is UTC+3 all year and never shifts', () => {
    expect(OBSERVES_DST.KW).toBe(false);
    for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']) {
      expect(offsetMs(new Date(iso), KW)).toBe(3 * 3600_000);
    }
  });

  it('Cairo is UTC+2 in winter and UTC+3 in summer', () => {
    expect(OBSERVES_DST.EG).toBe(true);
    expect(offsetMs(new Date('2026-01-15T12:00:00Z'), EG)).toBe(2 * 3600_000);
    expect(offsetMs(new Date('2026-07-15T12:00:00Z'), EG)).toBe(3 * 3600_000);
  });
});

describe('timezone abbreviations (§i18n — never ambiguous to a reader)', () => {
  it('Kuwait is always AST', () => {
    expect(tzAbbreviation(new Date('2026-01-15T12:00:00Z'), 'KW')).toBe('AST');
    expect(tzAbbreviation(new Date('2026-07-15T12:00:00Z'), 'KW')).toBe('AST');
  });
  it('Egypt resolves EET or EEST from the instant, not from the calendar', () => {
    expect(tzAbbreviation(new Date('2026-01-15T12:00:00Z'), 'EG')).toBe('EET');
    expect(tzAbbreviation(new Date('2026-07-15T12:00:00Z'), 'EG')).toBe('EEST');
  });
});

describe('local intent resolves to UTC instants, and both are kept', () => {
  it('a 21:00 Kuwait window is 18:00Z', () => {
    const w = resolveWindow({ localDate: '2026-09-03', localStart: '21:00', localEnd: '22:00', timezone: KW });
    expect(w.startUtc.toISOString()).toBe('2026-09-03T18:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-09-03T19:00:00.000Z');
  });

  it('a 21:00 Cairo window is 18:00Z in summer and 19:00Z in winter', () => {
    const summer = resolveWindow({ localDate: '2026-07-15', localStart: '21:00', localEnd: '22:00', timezone: EG });
    expect(summer.startUtc.toISOString()).toBe('2026-07-15T18:00:00.000Z');
    const winter = resolveWindow({ localDate: '2026-01-15', localStart: '21:00', localEnd: '22:00', timezone: EG });
    expect(winter.startUtc.toISOString()).toBe('2026-01-15T19:00:00.000Z');
  });

  it('round-trips: the resolved instant renders back as the authored local time', () => {
    for (const tz of [KW, EG]) {
      for (const date of ['2026-01-15', '2026-07-15', '2026-09-03']) {
        const w = resolveWindow({ localDate: date, localStart: '21:00', localEnd: '22:00', timezone: tz });
        const p = utcToZonedParts(w.startUtc, tz);
        expect(`${p.year}-${p.month}-${p.day}`).toBe(date);
        expect(`${p.hour}:${p.minute}`).toBe('21:00');
      }
    }
  });

  it('reads a genuine overnight window as crossing midnight', () => {
    const w = resolveWindow({ localDate: '2026-09-03', localStart: '23:00', localEnd: '00:30', timezone: KW });
    expect(w.endUtc.getTime() - w.startUtc.getTime()).toBe(90 * 60_000);
    expect(w.endUtc.toISOString()).toBe('2026-09-03T21:30:00.000Z');
  });

  it('refuses an inverted window rather than inventing a 23-hour one', () => {
    // A typo, not a pickup window. Silently rolling it to the next day would
    // publish a listing nobody meant to publish (§13-4: never silently clamp).
    expect(() => resolveWindow({ localDate: '2026-09-03', localStart: '22:00', localEnd: '21:00', timezone: KW }))
      .toThrow(/window_too_long/);
  });
});

describe('DST integrity (08-jobs.md §dst_integrity_check, §13-7)', () => {
  it('Cairo has both a non-existent and an ambiguous local time in 2026', () => {
    const problems = scanDstProblems(EG, 2026);
    expect(problems.some(p => p.problem === 'non_existent')).toBe(true);
    expect(problems.some(p => p.problem === 'ambiguous')).toBe(true);
  });

  it('Kuwait has none, so the job must no-op there', () => {
    expect(scanDstProblems(KW, 2026)).toHaveLength(0);
  });

  it('a skipped local time is reported, never silently shifted', () => {
    const gap = scanDstProblems(EG, 2026).find(p => p.problem === 'non_existent');
    expect(gap).toBeDefined();
    const res = checkDst({ localDate: gap!.localDate, localStart: gap!.localTime, localEnd: '23:59', timezone: EG });
    expect(res.ok).toBe(false);
    expect(res.problem).toBe('non_existent');
    // The partner is offered a concrete replacement, not just an error.
    expect(res.suggestedStart).toBeDefined();
  });

  it('an ambiguous local time is reported with a suggestion too', () => {
    const amb = scanDstProblems(EG, 2026).find(p => p.problem === 'ambiguous');
    expect(amb).toBeDefined();
    const res = checkDst({ localDate: amb!.localDate, localStart: amb!.localTime, localEnd: '23:59', timezone: EG });
    expect(res.ok).toBe(false);
    expect(res.problem).toBe('ambiguous');
  });

  it('an ordinary evening window is clean in both markets', () => {
    for (const tz of [KW, EG]) {
      expect(checkDst({ localDate: '2026-09-03', localStart: '21:00', localEnd: '22:00', timezone: tz }).ok).toBe(true);
    }
  });
});

describe('window state machine', () => {
  const start = new Date('2026-09-03T18:00:00Z');
  const end = new Date('2026-09-03T19:00:00Z');
  const grace = 30;

  it('is not_open before the window', () => {
    expect(windowState(new Date('2026-09-03T17:59:00Z'), start, end, grace)).toBe('not_open');
  });
  it('is open from the start', () => {
    expect(windowState(start, start, end, grace)).toBe('open');
    expect(windowState(new Date('2026-09-03T18:29:00Z'), start, end, grace)).toBe('open');
  });
  it('is closing_soon for the last 30 minutes', () => {
    expect(windowState(new Date('2026-09-03T18:30:00Z'), start, end, grace)).toBe('closing_soon');
    expect(windowState(new Date('2026-09-03T18:59:00Z'), start, end, grace)).toBe('closing_soon');
  });
  it('is closed from window end until the grace expires — late redemption lives here', () => {
    expect(windowState(end, start, end, grace)).toBe('closed');
    expect(windowState(new Date('2026-09-03T19:29:00Z'), start, end, grace)).toBe('closed');
  });
  it('is expired past the grace', () => {
    expect(windowState(new Date('2026-09-03T19:30:00Z'), start, end, grace)).toBe('expired');
  });
});
