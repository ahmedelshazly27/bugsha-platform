// S-C-010 — auth landing. Browsing needs no account; reserving does.
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { Button, Caption, Foot, Logo, Pp, Screen, T, color } from '@bugsha/ui';
import { useSession } from '../src/lib/session';
import { useL } from '../src/lib/ui';

export default function Landing() {
  const { userId, cityId, localeChosen, introSeen, hydrated } = useSession(); const { L, lang } = useL();
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: color.canvas }} />;
  if (!localeChosen) return <Redirect href="/onboarding/language" />;
  if (!introSeen) return <Redirect href="/onboarding/intro" />;
  if (userId && cityId) return <Redirect href="/(tabs)" />;
  if (userId) return <Redirect href="/onboarding/market" />;
  return <View style={{ flex: 1, backgroundColor: color.canvas }}>
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
      <Logo lockup="stacked" lang={lang} size={44} color={color.brand} />
      <View style={{ gap: 6, alignItems: 'center' }}>
        <T role="title" weight={700} align="center">{L('Save your bag before someone else does', 'احجز بقشتك قبل غيرك')}</T>
        <Pp style={{ textAlign: 'center' }}>{L('Browsing needs no account. Reserving does.', 'التصفّح لا يحتاج حساباً. الحجز يحتاج.')}</Pp></View>
    </Screen>
    <Foot>
      <Button size="lg" fullWidth iconStart="user" onPress={() => router.push('/auth/email')}>{L('Continue with email', 'المتابعة بالبريد الإلكتروني')}</Button>
      <Caption align="center" style={{ fontSize: 11, lineHeight: 16, paddingTop: 4 }}>{L('By continuing you accept the Terms and Privacy Policy.', 'بالمتابعة أنت توافق على الشروط وسياسة الخصوصية.')}</Caption>
    </Foot></View>;
}
