import { Stack } from 'expo-router'; import * as SplashScreen from 'expo-splash-screen'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context'; import { I18nManager, View } from 'react-native'; import { StatusBar } from 'expo-status-bar'; import { useEffect } from 'react';
import { isRtl } from '@bugsha/i18n'; import { color, useBugshaFonts } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session';
SplashScreen.preventAutoHideAsync().catch(() => {}); const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
export default function Root() {
  const { locale, set } = useSession(); const fonts = useBugshaFonts();
  useEffect(() => { const rtl = isRtl(locale); if (I18nManager.isRTL !== rtl) { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); } }, [locale]);
  useEffect(() => { db.auth.getSession().then(({ data }) => set({ userId: data.session?.user.id ?? null })); const { data: sub } = db.auth.onAuthStateChange((_e, s) => set({ userId: s?.user.id ?? null })); return () => sub.subscription.unsubscribe(); }, []);
  useEffect(() => { if (fonts) SplashScreen.hideAsync().catch(() => {}); }, [fonts]);
  if (!fonts) return <View style={{ flex: 1, backgroundColor: color.brandSurface }} />;
  return <SafeAreaProvider><QueryClientProvider client={qc}><StatusBar style="auto" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} /></QueryClientProvider></SafeAreaProvider>;
}
