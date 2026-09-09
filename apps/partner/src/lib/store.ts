import { create } from 'zustand'; import type { Market, PartnerRole } from '@bugsha/core';
interface S { storeId: string; partnerId: string; role: PartnerRole; storeName: string; tradingName: string; market: Market; timezone: string; set: (p: Partial<S>) => void; clear: () => void }
const empty = { storeId: '', partnerId: '', role: 'staff' as PartnerRole, storeName: '', tradingName: '', market: 'KW' as Market, timezone: 'Asia/Kuwait' };
export const useStore = create<S>((set) => ({ ...empty, set: (p) => set((s) => ({ ...s, ...p })), clear: () => set((s) => ({ ...s, ...empty })) }));
