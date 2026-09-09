// S-C-052 — money first; the environmental line is deliberately quiet.
import { router } from 'expo-router'; import { View } from 'react-native';
import { useImpact } from '@bugsha/api';
import { AppBar, Caption, Card, Icon, ImpactStat, Num, Screen, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { money, useL } from '../../src/lib/ui';
export default function Impact() {
  const { market } = useSession(); const { L } = useL(); const q = useImpact(db) as any; const d = q.data ?? {};
  return <View style={{ flex: 1 }}><AppBar title={L('Your impact', 'أثرك')} onBack={() => router.back()} />
    <Screen top={false} pad={16} gap={14}>
      <Card style={{ backgroundColor: color.brandSurface, borderColor: 'transparent' }}><View style={{ gap: 4 }}><Caption color="rgba(255,255,255,.8)">{L('Saved so far', 'وفّرتها حتى الآن')}</Caption><Num weight={700} color="#fff" style={{ fontSize: 38, lineHeight: 44 }}>{money(d.saved_minor ?? 0, market)}</Num><Caption color="rgba(255,255,255,.85)">{L(`across ${d.bags ?? 0} bags, against counter price`, `عبر ${d.bags ?? 0} بقشة مقارنة بسعر البيع`)}</Caption></View></Card>
      <View style={{ flexDirection: 'row', gap: 10 }}><ImpactStat icon="shopping-bag" value={String(d.bags ?? 0)} label={L('bags rescued', 'بقشة أُنقذت')} tone="brand" style={{ flex: 1 }} /><ImpactStat icon="store" value={String(d.stores ?? 0)} label={L('stores supported', 'متجراً دعمته')} tone="fresh" style={{ flex: 1 }} /></View>
      <Card><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="leaf" size={16} color={color.textSecondary} /><T role="label">{L(`Roughly ${d.estimated_kg ?? 0} kg of food kept out of the bin.`, `نحو ${d.estimated_kg ?? 0} كجم من الطعام لم تصل إلى النفايات.`)}</T></View></Card></Screen></View>;
}
