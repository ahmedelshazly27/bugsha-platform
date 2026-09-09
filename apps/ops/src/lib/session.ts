import { create } from 'zustand'; import type { LocaleCode } from '@bugsha/i18n'; import type { Market } from '@bugsha/core';
interface Session { userId: string | null; market: Market; cityId: string | null; locale: LocaleCode; online: boolean; set: (p: Partial<Omit<Session, 'set'>>) => void }
export const useSession = create<Session>((set) => ({ userId: null, market: 'KW', cityId: null, locale: 'en', online: true, set: (p) => set((s) => ({ ...s, ...p })) }));
