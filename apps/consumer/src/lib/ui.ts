/** Screen helpers shared by the consumer app: bilingual copy, market money, window maths. Western digits everywhere (design system). */
import type { Market } from '@bugsha/core';
import { useSession } from './session';

export const useL = () => { const { locale } = useSession(); const ar = locale !== 'en'; return { ar, L: (en: string, arText: string) => (ar ? arText : en), lang: (ar ? 'ar' : 'en') as 'ar' | 'en' }; };
export const CUR: Record<Market, { code: string; dp: number }> = { KW: { code: 'KD', dp: 3 }, EG: { code: 'EGP', dp: 2 } };
export const major = (minor: number, market: Market) => minor / Math.pow(10, CUR[market].dp);
export const money = (minor: number, market: Market) => `${CUR[market].code} ${major(minor, market).toFixed(CUR[market].dp)}`;
export const minutesLeft = (endUtc: string) => Math.max(0, Math.round((new Date(endUtc).getTime() - Date.now()) / 60000));
export const hhmm = (t: string) => String(t).slice(0, 5);
export const cdFmt = (ar: boolean) => (m: number) => (m >= 60 ? (ar ? `باقي ${Math.round(m / 60)} س` : `${Math.round(m / 60)} h left`) : ar ? `باقي ${m} د` : `${m} min left`);
export const leftFmt = (ar: boolean) => (n: number) => (ar ? `باقي ${n}` : `${n} left`);
export const bagTitle = (category: string | null | undefined, ar: boolean) => {
  const en: Record<string, string> = { bakery: 'Bakery bag', cafe: 'Café bag', meals: 'Meals bag', grocery: 'Grocery bag', sweets: 'Dessert bag' };
  const a: Record<string, string> = { bakery: 'بقشة مخبوزات', cafe: 'بقشة كافيه', meals: 'بقشة وجبات', grocery: 'بقشة بقالة', sweets: 'بقشة حلويات' };
  const k = category ?? 'other'; return ar ? a[k] ?? 'بقشة مفاجأة' : en[k] ?? 'Surprise bag';
};
export const regulator = (market: Market, ar: boolean) => (market === 'KW' ? (ar ? 'الهيئة العامة للغذاء والتغذية' : 'PAFN') : ar ? 'الهيئة القومية لسلامة الغذاء' : 'NFSA');
/** Isolate a date, time or code inside an Arabic sentence so bidi reordering leaves it as typed. */
export const ltr = (v: string | number) => `\u2066${v}\u2069`;
