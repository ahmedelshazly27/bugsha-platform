import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nManager } from 'react-native';
import { useEffect } from 'react';
import { isRtl } from '@bugsha/i18n';
import { db } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

export default function Root() {
  const { locale, set } = useSession();
  useEffect(() => {
    // Full mirroring for Arabic: layout, navigation, gestures (11-i18n.md §5).
    const rtl = isRtl(locale); if (I18nManager.isRTL !== rtl) { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); }
    db.auth.getSession().then(({ data }) => set({ userId: data.session?.user.id ?? null }));
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => set({ userId: s?.user.id ?? null }));
    return () => sub.subscription.unsubscribe();
  }, [locale]);
  return <SafeAreaProvider><QueryClientProvider client={qc}><Stack screenOptions={{ headerShown: false }} /></QueryClientProvider></SafeAreaProvider>;
}
