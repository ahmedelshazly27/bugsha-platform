/** Device/session state lives in Zustand; server state is react-query only (01-architecture.md §4). */
import { create } from 'zustand';
import type { LocaleCode } from '@bugsha/i18n';
import type { Market } from '@bugsha/core';
interface Session { userId: string | null; market: Market; cityId: string | null; cityName: string; lat: number | null; lng: number | null; locale: LocaleCode; online: boolean; set: (p: Partial<Omit<Session, 'set'>>) => void }
export const useSession = create<Session>((set) => ({ userId: null, market: 'KW', cityId: null, cityName: '', lat: null, lng: null, locale: 'ar-KW', online: true, set: (p) => set((s) => ({ ...s, ...p })) }));
