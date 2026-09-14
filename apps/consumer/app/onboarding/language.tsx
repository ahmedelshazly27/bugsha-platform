// S-C-001 — first run only. Three choices: English, Arabic for Kuwait, Arabic for Egypt. The Arabic choice also
// sets the market, because the Gulf and Egyptian registers are authored separately (11-i18n.md).
import { router } from 'expo-router'; import { Pressable, View } from 'react-native';
import type { LocaleCode } from '@bugsha/i18n';
import { Button, Caption, Foot, Icon, Logo, Pp, Screen, T, color, radius } from '@bugsha/ui';
import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Language() {
  const s = useSession(); const { L } = useL();
  const opts: Array<[LocaleCode, string, string, boolean]> = [['en', 'English', 'Kuwait & Egypt · Latin numerals', false], ['ar-KW', 'العربية', 'الكويت', true], ['ar-EG', 'العربية', 'مصر', true]];
  const pick = (loc: LocaleCode) => s.set({ locale: loc, ...(loc === 'ar-KW' ? { market: 'KW' as const } : loc === 'ar-EG' ? { market: 'EG' as const } : {}) });
  return <View style={{ flex: 1 }}><Screen pad={20} gap={16}><Logo lockup="mark" size={38} color={color.brand} />
    <View style={{ gap: 4 }}><T role="titleLg" weight={700}>{L('Choose your language', 'اختر لغتك')}</T><Pp>{L('You can change this later in Settings.', 'يمكنك تغييرها لاحقاً من الإعدادات.')}</Pp></View>
    <View style={{ gap: 10 }}>{opts.map(([loc, label, sub, arabic]) => { const sel = s.locale === loc; return <Pressable key={loc} onPress={() => pick(loc)} accessibilityRole="radio" accessibilityState={{ selected: sel }} style={{ borderWidth: 1.5, borderColor: sel ? color.brand : color.border, backgroundColor: sel ? color.brandTint : color.raised, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
      <View style={{ flex: 1 }}><T role="headline" weight={600} style={{ fontFamily: arabic ? 'Alexandria_500Medium' : 'Archivo_600SemiBold' }}>{label}</T><Caption style={arabic ? { fontFamily: 'Alexandria_400Regular' } : undefined}>{sub}</Caption></View>{sel ? <Icon name="circle-check" size={20} color={color.brand} /> : null}</Pressable>; })}</View></Screen>
    <Foot><Button size="lg" fullWidth iconEnd="arrow-right" onPress={() => { s.set({ localeChosen: true }); router.replace('/onboarding/intro'); }}>{L('Continue', 'متابعة')}</Button></Foot></View>;
}
