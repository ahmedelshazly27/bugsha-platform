// S-C-006 — the onboarding carousel. Panel 2 is the one the product depends on: surplus, not expired, regulator named.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { Badge, Button, Foot, Icon, Pp, Screen, T, color } from '@bugsha/ui';
import { useSession } from '../../src/lib/session'; import { regulator, useL } from '../../src/lib/ui';
export default function Intro() {
  const { market } = useSession(); const { L, ar } = useL(); const [i, setI] = useState(0);
  const panels = [
    { icon: 'shopping-bag', h: L("What's in the bag?", 'ما الذي في البقشة؟'), p: L("The store packs what's genuinely left at close — good food, chosen by them, at a fraction of its counter price. You know the category, the value and the price before you pay.", 'يعبّئ المتجر ما تبقى فعلاً عند الإغلاق — طعام جيد يختاره هو، بجزء بسيط من سعره. تعرف الفئة والقيمة والسعر قبل الدفع.') },
    { icon: 'circle-check', h: L('Surplus, not expired', 'فائض، وليس منتهي الصلاحية'), p: L('Everything listed is food the store could legally sell today and simply didn\'t. Partners are licensed food businesses inspected by their national authority.', 'كل ما يُعرض طعام كان بإمكان المتجر بيعه اليوم قانونياً ولم يُبع. جميع الشركاء منشآت غذائية مرخّصة وخاضعة للتفتيش.') },
    { icon: 'clock', h: L('Collect in person, in a window', 'استلام شخصي ضمن وقت محدد'), p: L('No delivery. Each bag has a pickup window — usually 30 to 120 minutes. Show your code at the counter, take the bag, done.', 'لا يوجد توصيل. لكل بقشة وقت استلام — عادة من 30 إلى 120 دقيقة. أظهر رمزك عند الكاشير واستلم.') },
  ]; const p = panels[i]!;
  return <View style={{ flex: 1 }}><View style={{ alignItems: 'flex-end', paddingTop: 54, paddingHorizontal: 14 }}><Button variant="ghost" size="sm" onPress={() => router.replace('/')}>{L('Skip', 'تخطي')}</Button></View>
    <Screen top={false} scroll={false} pad={20} gap={18} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ width: 76, height: 76, borderRadius: 20, backgroundColor: color.brandTint, alignItems: 'center', justifyContent: 'center' }}><Icon name={p.icon} size={34} color={color.brand} /></View>
      <View style={{ gap: 8 }}><T role="titleLg" weight={700} align="center">{p.h}</T><Pp style={{ textAlign: 'center', fontSize: 14.5, lineHeight: 22 }}>{p.p}</Pp></View>
      {i === 1 ? <Badge tone="fresh">{L('Inspected by ', 'خاضع لرقابة ') + regulator(market, ar)}</Badge> : null}</Screen>
    <Foot><View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', paddingBottom: 4 }}>{[0, 1, 2].map((n) => <View key={n} style={{ width: n === i ? 20 : 6, height: 6, borderRadius: 99, backgroundColor: n === i ? color.brand : color.border }} />)}</View>
      <Button size="lg" fullWidth iconEnd="arrow-right" onPress={() => (i === 2 ? router.replace('/') : setI(i + 1))}>{i === 2 ? L("See tonight's bags", 'شاهد بقش الليلة') : L('Next', 'التالي')}</Button></Foot></View>;
}
