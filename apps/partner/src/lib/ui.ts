import type { Market } from '@bugsha/core'; import { useSession } from './session';
export const useL = () => { const { locale } = useSession(); const ar = locale !== 'en'; return { ar, L: (en: string, a: string) => (ar ? a : en), lang: (ar ? 'ar' : 'en') as 'ar' | 'en' }; };
export const CUR: Record<Market, { code: string; dp: number }> = { KW: { code: 'KD', dp: 3 }, EG: { code: 'EGP', dp: 2 } };
export const major = (minor: number, m: Market) => minor / Math.pow(10, CUR[m].dp);
export const money = (minor: number, m: Market) => `${CUR[m].code} ${major(minor, m).toFixed(CUR[m].dp)}`;
export const minutesLeft = (endUtc: string) => Math.max(0, Math.round((new Date(endUtc).getTime() - Date.now()) / 60000));
export const hm = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
export const hhmm = (t: string) => String(t).slice(0, 5);
