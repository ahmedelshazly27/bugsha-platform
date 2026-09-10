/** Device/session state: persisted preferences (language, market, city) plus in-memory auth/online flags. Server state is react-query only (01-architecture.md §4). */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocaleCode } from '@bugsha/i18n';
import type { Market } from '@bugsha/core';
interface Session { userId: string | null; market: Market; cityId: string | null; cityName: string; lat: number | null; lng: number | null; locale: LocaleCode; localeChosen: boolean; introSeen: boolean; online: boolean; hydrated: boolean; set: (p: Partial<Omit<Session, 'set'>>) => void }
export const useSession = create<Session>()(persist((set) => ({ userId: null, market: 'KW', cityId: null, cityName: '', lat: null, lng: null, locale: 'ar-KW', localeChosen: false, introSeen: false, online: true, hydrated: false, set: (p) => set((s) => ({ ...s, ...p })) }),
  { name: 'bugsha.session', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ market: s.market, cityId: s.cityId, cityName: s.cityName, locale: s.locale, localeChosen: s.localeChosen, introSeen: s.introSeen }), onRehydrateStorage: () => (state) => { state?.set({ hydrated: true }); } }));
