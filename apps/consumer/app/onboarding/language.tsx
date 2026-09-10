// S-C-002 — first run only. Selecting re-lays out the whole app: direction, type family.
import { router } from 'expo-router'; import { Pressable, View } from 'react-native';
import { Button, Caption, Foot, Icon, Logo, Pp, Screen, T, color, radius } from '@bugsha/ui';
import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Language() {
  const s = useSession(); const { L, ar } = useL();
  const row = (sel: boolean, label: string, sub: string, arabic: boolean, onPress: () => void) => <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: sel }} style={{ borderWidth: 1.5, borderColor: sel ? color.brand : color.border, backgroundColor: sel ? color.brandTint : color.raised, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
    <View style={{ flex: 1 }}><T role="headline" weight={600} style={{ fontFamily: arabic ? 'Alexandria_500Medium' : 'Archivo_600SemiBold' }}>{label}</T><Caption>{sub}</Caption></View>{sel ? <Icon name="circle-check" size={20} color={color.brand} /> : null}</Pressable>;
  return <View style={{ flex: 1 }}><Screen pad={20} gap={16}><Logo lockup="mark" size={38} color={color.brand} />
    <View style={{ gap: 4 }}><T role="titleLg" weight={700}>{L('Choose your language', 'اختر لغتك')}</T><Pp>{L('You can change this later in Settings.', 'يمكنك تغييرها لاحقاً من الإعدادات.')}</Pp></View>
    <View style={{ gap: 10 }}>{row(ar, 'العربية', 'الخليج ومصر', true, () => s.set({ locale: s.market === 'KW' ? 'ar-KW' : 'ar-EG' }))}{row(!ar, 'English', 'Latin numerals', false, () => s.set({ locale: 'en' }))}</View></Screen>
    <Foot><Button size="lg" fullWidth iconEnd="arrow-right" onPress={() => { s.set({ localeChosen: true }); router.replace('/onboarding/intro'); }}>{L('Continue', 'متابعة')}</Button></Foot></View>;
}
