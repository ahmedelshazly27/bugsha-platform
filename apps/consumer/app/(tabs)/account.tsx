// S-C-016 — account hub.
import { router } from 'expo-router'; import { View } from 'react-native';
import { useWallet, rpc } from '@bugsha/api';
import { AppBar, Caption, ListRow, Num, Screen, SegmentedControl, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { money, useL } from '../../src/lib/ui';
export default function Account() {
  const s = useSession(); const { L, ar } = useL(); const wallet = useWallet(db) as any;
  const initial = (ar ? 'ب' : 'B');
  const rows: Array<[string, string, string, (() => void) | undefined, React.ReactNode?]> = [
    ['user', 'Profile', 'الملف الشخصي', () => router.push('/account/profile')],
    ['wallet', 'Wallet & credit', 'المحفظة والرصيد', () => router.push('/account/wallet'), wallet.data ? <Num role="label" color={color.textSecondary}>{money(wallet.data.balance_minor ?? 0, s.market)}</Num> : undefined],
    ['bell', 'Notifications', 'الإشعارات', () => router.push('/account/notifications')],
    ['map-pin', 'Market & city', 'السوق والمدينة', () => router.push('/onboarding/market'), <Caption>{s.cityName}</Caption>],
    ['utensils', 'Dietary preferences', 'التفضيلات الغذائية', () => router.push('/account/dietary')],
    ['heart', 'Saved stores', 'المتاجر المحفوظة', () => router.navigate('/(tabs)/saved')],
    ['receipt', 'Order history', 'سجل الطلبات', () => router.navigate('/(tabs)/orders')],
    ['leaf', 'Your impact', 'أثرك', () => router.push('/account/impact')],
    ['share-2', 'Invite a friend', 'ادعُ صديقاً', () => router.push('/account/invite')],
    ['info', 'Help', 'المساعدة', () => router.push('/account/help')],
    ['leaf', 'Food safety', 'سلامة الغذاء', () => router.push('/account/safety')],
    ['file-text', 'Legal', 'الوثائق القانونية', () => router.push('/account/legal')],
    ['trash-2', 'Delete account', 'حذف الحساب', () => router.push('/account/delete')],
  ];
  return <View style={{ flex: 1 }}><AppBar title={L('Account', 'حسابي')} back={false} />
    <Screen top={false} pad={0} gap={0}>
      <View style={{ padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: color.raised }}><View style={{ width: 46, height: 46, borderRadius: 99, backgroundColor: color.brandTint, alignItems: 'center', justifyContent: 'center' }}><T weight={700} color={color.brand} style={{ fontSize: 18, lineHeight: 24 }}>{initial}</T></View><View><T weight={600}>{L('Your account', 'حسابك')}</T><Caption>{s.market === 'KW' ? L('Kuwait', 'الكويت') : L('Egypt', 'مصر')}</Caption></View></View>
      <ListRow icon="settings" label={L('App language', 'لغة التطبيق')} value={<SegmentedControl fullWidth={false} value={ar ? 'ar' : 'en'} onChange={(v) => { const loc = v === 'en' ? 'en' : s.market === 'KW' ? 'ar-KW' : 'ar-EG'; s.set({ locale: loc }); rpc(db, 'set_locale', { p_locale: loc, p_numerals: 'western' }).catch(() => {}); }} options={[{ value: 'ar', label: 'ع' }, { value: 'en', label: 'EN' }]} />} />
      {rows.map(([icon, en, a, onPress, value]) => <ListRow key={en} icon={icon} label={L(en, a)} value={value} chevron={!!onPress} onPress={onPress} />)}
      <ListRow icon="arrow-left" label={L('Sign out', 'تسجيل الخروج')} onPress={() => db.auth.signOut().then(() => router.replace('/'))} />
    </Screen></View>;
}
