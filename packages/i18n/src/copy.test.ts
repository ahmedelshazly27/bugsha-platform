/**
 * The CI gates from docs/11-i18n.md §1 and §i18n of the test plan.
 * A missing key or a banned term fails the build — that is the whole point.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, type LocaleCode } from './index';

const COPY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'copy');
// Files prefixed with '_' are lint configuration, not copy.
const files = readdirSync(COPY_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const load = (f: string) => JSON.parse(readFileSync(join(COPY_DIR, f), 'utf8')) as Record<string, unknown>;
const forbidden = JSON.parse(readFileSync(join(COPY_DIR, '_forbidden.json'), 'utf8')) as
  Record<string, Record<string, string[]>>;
const exceptions = JSON.parse(readFileSync(join(COPY_DIR, '_lint-exceptions.json'), 'utf8')) as {
  forbidden_terms: Array<{ file: string; key: string; term: string; locales: string[]; reason: string }>;
  identical_arabic_registers: Array<{ file: string; key: string; reason: string }>;
};

/**
 * `allowed_register` is the APPROVED vocabulary, not a ban list — matching on
 * it would fail the build for using the very words §1 asks for.
 */
const BANNED_GROUPS = ['about_the_food', 'manufactured_urgency', 'charity_or_guilt'] as const;

const isAllowed = (file: string, key: string, term: string, locale: string) =>
  exceptions.forbidden_terms.some((e) =>
    e.file === file && e.key === key && e.term === term && e.locales.includes(locale));

/** Walk a copy file and yield every {en, ar-KW, ar-EG} leaf with its key path. */
function* leaves(obj: unknown, path: string[] = []): Generator<{ key: string; value: Record<string, string> }> {
  if (obj === null || typeof obj !== 'object') return;
  const rec = obj as Record<string, unknown>;
  if (LOCALES.every((l) => typeof rec[l] === 'string')) {
    yield { key: path.join('.'), value: rec as Record<string, string> };
    return;
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    yield* leaves(v, [...path, k]);
  }
}

describe('key completeness — every key exists in all three locales', () => {
  for (const file of files) {
    it(`${file} is complete`, () => {
      const found = [...leaves(load(file))];
      expect(found.length, `${file} has no localised strings`).toBeGreaterThan(0);
      for (const { key, value } of found) {
        for (const locale of LOCALES) {
          expect(typeof value[locale], `${file} ${key} missing ${locale}`).toBe('string');
          expect(value[locale]!.length, `${file} ${key} empty in ${locale}`).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe('forbidden terms — a banned word fails the build (§1)', () => {
  for (const file of files) {
    it(`${file} uses no banned term`, () => {
      for (const { key, value } of leaves(load(file))) {
        for (const locale of LOCALES) {
          const text = value[locale]!.toLowerCase();
          for (const group of BANNED_GROUPS) {
            for (const term of forbidden[group]?.[locale] ?? []) {
              if (isAllowed(file, key, term, locale)) continue;
              expect(text.includes(term.toLowerCase()), `${file} ${key} [${locale}] contains "${term}"`).toBe(false);
            }
          }
        }
      }
    });
  }

  it('the banned list covers food terms, manufactured urgency and guilt', () => {
    expect(Object.keys(forbidden)).toEqual(expect.arrayContaining([...BANNED_GROUPS]));
    for (const locale of LOCALES) {
      for (const group of BANNED_GROUPS) {
        expect(forbidden[group]![locale]!.length, `${group}.${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it('every reviewed exception is still needed — a stale one fails the build', () => {
    for (const e of exceptions.forbidden_terms) {
      const entry = [...leaves(load(e.file))].find((l) => l.key === e.key);
      expect(entry, `${e.file} ${e.key} no longer exists`).toBeDefined();
      for (const locale of e.locales) {
        expect(entry!.value[locale as LocaleCode]!.toLowerCase(),
          `${e.key} no longer contains "${e.term}" — drop the exception`).toContain(e.term.toLowerCase());
      }
      expect(e.reason.length, `${e.key} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe('register distinctness — ar-KW and ar-EG are not the same language', () => {
  it('the core interface strings differ between the two Arabic registers', () => {
    const core = [...leaves(load('common.json'))];
    const reviewed = new Set(exceptions.identical_arabic_registers
      .filter((e) => e.file === 'common.json').map((e) => e.key));
    const identical = core
      .filter((l) => l.value['ar-KW'] === l.value['ar-EG'])
      .map((l) => l.key)
      .filter((k) => !reviewed.has(k));
    // An identical pair usually means one was copied from the other. The doc
    // asks for it to be FLAGGED for review, so a reviewed pair is allowed
    // through by name and everything else fails.
    expect(identical).toEqual([]);
  });
});

describe('placeholders line up across locales', () => {
  it('every locale of a key uses the same placeholder set', () => {
    for (const file of files) {
      for (const { key, value } of leaves(load(file))) {
        const setOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const en = setOf(value.en!);
        for (const locale of LOCALES) {
          expect(setOf(value[locale]!), `${file} ${key} [${locale}]`).toEqual(en);
        }
      }
    }
  });
});

describe('error copy says what happened and what to do (§8)', () => {
  const errors = load('errors.json');
  it('covers the codes the docs name explicitly', () => {
    for (const code of ['BG100', 'BG110', 'BG113', 'BG114', 'BG140']) {
      expect(Object.keys(errors)).toContain(code);
    }
  });
  it('never shows a bare code or "an error occurred"', () => {
    for (const { key, value } of leaves(errors)) {
      for (const locale of LOCALES) {
        expect(value[locale]!.toLowerCase()).not.toMatch(/an error occurred|unknown error/);
        expect(value[locale]!, key).not.toMatch(/^BG\d+$/);
      }
    }
  });
});

describe('refund timing is keyed by market and destination (rule 8)', () => {
  it('has a string for every market and destination pair in use', () => {
    const timing = load('refund-timing.json');
    for (const k of ['KW.wallet', 'KW.knet', 'EG.wallet']) {
      expect(Object.keys(timing)).toContain(k);
    }
  });
});
