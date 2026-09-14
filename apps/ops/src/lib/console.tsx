// Shared desk chrome for the ops console: panels, form boxes, key/value rows, money and time
// formatting, and the act() helper that turns RPC outcomes (incl. four-eyes pending, re-auth) into a banner.
import { useState, type ReactNode } from 'react'; import { Platform, View, type ViewStyle } from 'react-native';
import { isPendingApproval } from '@bugsha/api'; import { Caption, Chip, Chips, Eyebrow, T, color } from '@bugsha/ui';
export type Market = 'KW' | 'EG';
export const MARKETS: Market[] = ['KW', 'EG'];
const CUR: Record<Market, { code: string; dp: number }> = { KW: { code: 'KWD', dp: 3 }, EG: { code: 'EGP', dp: 2 } };
export const money = (minor: number | string | null | undefined, market: Market | string = 'KW') => { const c = CUR[(market as Market)] ?? CUR.KW; const n = Number(minor ?? 0) / 10 ** c.dp; return `${c.code} ${n.toLocaleString('en-GB', { minimumFractionDigits: c.dp, maximumFractionDigits: c.dp })}`; };
export const toMinor = (major: string, market: Market | string = 'KW') => Math.round(Number(major || 0) * 10 ** ((CUR[market as Market] ?? CUR.KW).dp));
export const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
export const short = (id?: string | null) => (id ? String(id).slice(0, 8) : '—');
export const Panel = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }, style]}>{children}</View>;
export const FormBox = ({ title, children }: { title?: string; children: ReactNode }) => <View style={{ gap: 10, padding: 12, backgroundColor: color.sunken, borderRadius: 8 }}>{title ? <T role="label" weight={600}>{title}</T> : null}{children}</View>;
export const Field = ({ k, v, w = 130 }: { k: string; v: ReactNode; w?: number }) => <View style={{ flexDirection: 'row', gap: 8 }}><Caption style={{ width: w }}>{k}</Caption>{typeof v === 'string' || typeof v === 'number' ? <T role="label" style={{ flex: 1 }}>{String(v)}</T> : <View style={{ flex: 1 }}>{v}</View>}</View>;
export const Row = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, style]}>{children}</View>;
export const Empty = ({ children }: { children: ReactNode }) => <Caption style={{ padding: 14 }}>{children}</Caption>;
export const Choice = <V extends string>({ label, options, value, onChange }: { label?: string; options: Array<[V, string]>; value: V | null; onChange: (v: V) => void }) => <View style={{ gap: 6 }}>{label ? <Eyebrow>{label}</Eyebrow> : null}<Chips>{options.map(([k, l]) => <Chip key={k} selected={value === k} onPress={() => onChange(k)}>{l}</Chip>)}</Chips></View>;
export const MarketToggle = ({ value, onChange, all }: { value: Market | null; onChange: (m: Market | null) => void; all?: boolean }) => <Chips>{all ? <Chip selected={value === null} onPress={() => onChange(null)}>All markets</Chip> : null}<Chip selected={value === 'KW'} onPress={() => onChange('KW')}>Kuwait</Chip><Chip selected={value === 'EG'} onPress={() => onChange('EG')}>Egypt</Chip></Chips>;
/** Runs a mutation and reports the outcome; the caller decides what to refetch. */
export function useAct() {
  const [msg, setMsg] = useState(''); const [tone, setTone] = useState<'info' | 'fresh' | 'error' | 'time'>('info');
  const act = (m: { mutateAsync: (a: any) => Promise<any> }, args: Record<string, unknown>, ok: string, after?: () => void) => m.mutateAsync(args).then((r: any) => {
    if (isPendingApproval(r)) { setTone('time'); setMsg('Recorded — needs a second approver (a different admin, re-authenticated within 5 minutes).'); } else { setTone('fresh'); setMsg(ok); }
    after?.(); return r;
  }, (e: any) => { setTone('error'); setMsg(e?.code === 'BG131' ? 'Re-authenticate (sign in again) to run money operations.' : e?.code === 'BG100' ? 'Your ops role is not allowed to do this.' : `${e?.code ?? 'Error'}: ${e?.serverMessage ?? e?.message ?? ''}`); throw e; }).catch(() => undefined);
  return { msg, tone, act, setMsg, clear: () => setMsg('') };
}
/** CSV export: opens a data URL on web (the console runs in the browser); no-op elsewhere. */
export function exportCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return; const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  if (Platform.OS === 'web' && typeof document !== 'undefined') { const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = `${name}-${isoDate(new Date())}.csv`; a.click(); }
}
