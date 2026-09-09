import { Stack } from 'expo-router'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { SafeAreaProvider } from 'react-native-safe-area-context'; import { View } from 'react-native'; import { useEffect } from 'react';
import { color, useBugshaFonts } from '@bugsha/ui'; import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session';
const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
export default function Root() { const set = useSession((s) => s.set); const fonts = useBugshaFonts();
  useEffect(() => { db.auth.getSession().then(({ data }) => set({ userId: data.session?.user.id ?? null })); const { data: sub } = db.auth.onAuthStateChange((_e, s) => set({ userId: s?.user.id ?? null })); return () => sub.subscription.unsubscribe(); }, []);
  if (!fonts) return <View style={{ flex: 1, backgroundColor: color.canvas }} />;
  return <SafeAreaProvider><QueryClientProvider client={qc}><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} /></QueryClientProvider></SafeAreaProvider>; }
