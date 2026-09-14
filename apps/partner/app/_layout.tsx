import { Stack } from 'expo-router'; import * as SplashScreen from 'expo-splash-screen'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context'; import { I18nManager, View } from 'react-native'; import { StatusBar } from 'expo-status-bar'; import { useEffect } from 'react';
import { isRtl } from '@bugsha/i18n'; import { useMyStores } from '@bugsha/api'; import { color, setRTL, useBugshaFonts } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { useStore } from '../src/lib/store';
SplashScreen.preventAutoHideAsync().catch(() => {}); const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
export default function Root() {
  const { locale, set } = useSession(); const fonts = useBugshaFonts();
  const rtl = isRtl(locale); setRTL(rtl);
  useEffect(() => { if (I18nManager.isRTL !== rtl) { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); } }, [rtl]);
  useEffect(() => { db.auth.getSession().then(({ data }) => set({ userId: data.session?.user.id ?? null })); const { data: sub } = db.auth.onAuthStateChange((_e, s) => set({ userId: s?.user.id ?? null })); return () => sub.subscription.unsubscribe(); }, []);
  useEffect(() => { if (fonts) SplashScreen.hideAsync().catch(() => {}); }, [fonts]);
  if (!fonts) return <View style={{ flex: 1, backgroundColor: color.brandSurface }} />;
  return <SafeAreaProvider><QueryClientProvider client={qc}><StatusBar style="auto" /><StoreHydrator /><View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} /></View></QueryClientProvider></SafeAreaProvider>;
}
/** Deep links (a push to /orders, a QR link) can land before the tab layout mounts: hydrate the active store here too. */
function StoreHydrator() {
  const { userId } = useSession(); const store = useStore(); const stores = useMyStores(db, !!userId && !store.storeId);
  useEffect(() => { const only = (stores.data ?? [])[0]; if (stores.data?.length === 1 && only && !store.storeId) store.set({ storeId: only.store_id, partnerId: only.partner_id, role: only.role as any, storeName: only.display_name, tradingName: only.trading_name, market: only.market as any, timezone: only.timezone }); }, [stores.data]);
  return null;
}
