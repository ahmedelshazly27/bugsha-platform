// S-C-003 — market sets currency, payment methods, cities and legal text.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import type { Market } from '@bugsha/core';
import { AppBar, Banner, Button, Caption, Card, Foot, Icon, Num, Pp, Screen, T, color } from '@bugsha/ui';
import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function MarketPick() {
  const s = useSession(); const { L } = useL(); const [m, setM] = useState<Market>(s.market);
  const row = (mk: Market, name: string, sub: React.ReactNode) => <Card onPress={() => setM(mk)} style={{ borderColor: m === mk ? color.brand : color.borderSubtle, borderWidth: m === mk ? 1.5 : 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><T weight={600}>{name}</T><Caption>{sub}</Caption></View>{m === mk ? <Icon name="circle-check" size={20} color={color.brand} /> : null}</View></Card>;
  return <View style={{ flex: 1 }}><AppBar title={L('Where are you?', 'أين أنت؟')} back={false} />
    <Screen top={false} pad={16}><Pp>{L('Your market sets currency, payment methods, cities and legal documents.', 'السوق يحدد العملة وطرق الدفع والمدن والوثائق القانونية.')}</Pp>
      {row('KW', L('Kuwait', 'الكويت'), <><Num role="caption" color={color.textSecondary}>KWD</Num> · KNET, Apple Pay · <Num role="caption" color={color.textSecondary}>+965</Num></>)}
      {row('EG', L('Egypt', 'مصر'), <><Num role="caption" color={color.textSecondary}>EGP</Num> · {L('Card, wallet, InstaPay, Fawry, cash', 'بطاقة، محفظة، إنستاباي، فوري، نقداً')}</>)}
      <Banner tone="info" title={L('Nothing is locked yet', 'لا شيء مثبّت بعد')}>{L('You can change market later from Account.', 'يمكنك تغيير السوق لاحقاً من حسابك.')}</Banner></Screen>
    <Foot><Button size="lg" fullWidth onPress={() => { s.set({ market: m, locale: s.locale === 'en' ? 'en' : m === 'KW' ? 'ar-KW' : 'ar-EG' }); router.push('/onboarding/city'); }}>{L('Continue', 'متابعة')}</Button></Foot></View>;
}
