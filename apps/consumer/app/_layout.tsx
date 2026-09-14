import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nManager, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { isRtl } from '@bugsha/i18n';
import { Banner, color, setRTL, useBugshaFonts } from '@bugsha/ui';
import NetInfo from '@react-native-community/netinfo';
import { db } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';

SplashScreen.preventAutoHideAsync().catch(() => {});
const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

export default function Root() {
  const { locale, online, set } = useSession(); const fonts = useBugshaFonts();
  useEffect(() => NetInfo.addEventListener((n) => set({ online: !!n.isConnected })), []);
  // Full mirroring for Arabic: layout, navigation, gestures (11-i18n.md §5). setRTL + the root `direction` apply at once;
  // I18nManager covers native navigation gestures and Android after the next launch.
  const rtl = isRtl(locale); setRTL(rtl);
  useEffect(() => { if (I18nManager.isRTL !== rtl) { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); } }, [rtl]);
  useEffect(() => {
    db.auth.getSession().then(({ data }) => set({ userId: data.session?.user.id ?? null }));
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => set({ userId: s?.user.id ?? null }));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (fonts) SplashScreen.hideAsync().catch(() => {}); }, [fonts]);
  if (!fonts) return <View style={{ flex: 1, backgroundColor: color.brandSurface }} />;
  return <SafeAreaProvider><QueryClientProvider client={qc}><StatusBar style="auto" />{!online ? <View style={{ paddingTop: 54, paddingHorizontal: 14, backgroundColor: color.canvas }}><Banner tone="offline" title="No connection">Prices and windows may be out of date. Your code still works.</Banner></View> : null}<View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} /></View></QueryClientProvider></SafeAreaProvider>;
}
