/** Device/session state for the partner app. The chosen language persists across launches; auth and online flags are in-memory. */
import { create } from 'zustand'; import { createJSONStorage, persist } from 'zustand/middleware'; import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocaleCode } from '@bugsha/i18n'; import type { Market } from '@bugsha/core';
interface Session { userId: string | null; market: Market; cityId: string | null; locale: LocaleCode; online: boolean; set: (p: Partial<Omit<Session, 'set'>>) => void }
export const useSession = create<Session>()(persist((set) => ({ userId: null, market: 'KW', cityId: null, locale: 'ar-KW', online: true, set: (p) => set((s) => ({ ...s, ...p })) }),
  { name: 'bugsha.partner.session', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ locale: s.locale }) }));
