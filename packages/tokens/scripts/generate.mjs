// Reads the design system's styles.css @import closure and emits tokens.ts.
// Source of truth is the DS project (tokens/*.css); DO NOT hand-edit output.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DS = process.env.BUGSHA_DS_DIR ?? resolve(process.cwd(), '../../../Bugsha');
const seen = new Set(); const vars = {}; const order = [];
function walk(file) {
  if (seen.has(file)) return; seen.add(file);
  const css = readFileSync(file, 'utf8');
  for (const m of css.matchAll(/@import\s+url\(["']?([^"')]+)["']?\)/g)) {
    if (!/^https?:/.test(m[1])) walk(join(dirname(file), m[1]));
  }
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gmi)) {
    if (!(m[1] in vars)) order.push(m[1]);
    vars[m[1]] = m[2].trim();   // last write wins: variants override base
  }
}
walk(join(DS, 'styles.css'));
const toKey = (v) => v.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const out = [
  '// GENERATED from the Bugsha design system styles.css closure — do not hand-edit.',
  `// Source: ${DS}`,
  'export const cssVars = {',
  ...order.map((v) => `  '${v}': ${JSON.stringify(vars[v])},`),
  '} as const;',
  '', 'export const tokens = {',
  ...order.map((v) => `  ${toKey(v)}: cssVars['${v}'],`),
  '} as const;',
  '', 'export type TokenName = keyof typeof tokens;',
  '', '/** Resolve var(--x) references to their literal value for React Native. */',
  'export function resolve(value: string, depth = 0): string {',
  "  if (depth > 8) return value;",
  "  return value.replace(/var\\((--[a-z0-9-]+)\\)/gi, (_, name) => resolve((cssVars as Record<string, string>)[name] ?? '', depth + 1));",
  '}', '',
].join('\n');
writeFileSync(resolve(process.cwd(), 'src/tokens.ts'), out);
console.log(`${order.length} tokens from ${seen.size} files`);
