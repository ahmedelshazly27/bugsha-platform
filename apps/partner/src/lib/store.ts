import { create } from 'zustand'; import type { PartnerRole } from '@bugsha/core';
interface S { storeId: string; partnerId: string; role: PartnerRole; storeName: string; set: (p: Partial<S>) => void }
export const useStore = create<S>((set) => ({ storeId: '', partnerId: '', role: 'staff', storeName: '', set: (p) => set((s) => ({ ...s, ...p })) }));
