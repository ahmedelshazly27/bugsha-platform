// S-C-004 — searchable, grouped: live now / coming soon. A waitlist city routes to S-C-005.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useCities } from '@bugsha/api';
import { AppBar, Badge, Eyebrow, Input, ListRow, Screen, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
type City = { id: string; name_en: string; name_ar: string; stage: string };
export default function CityPick() {
  const s = useSession(); const { L, ar } = useL(); const q = useCities(db, s.market); const [f, setF] = useState('');
  const all = ((q.data as City[]) ?? []).filter((c) => (ar ? c.name_ar : c.name_en).toLowerCase().includes(f.toLowerCase()));
  const live = all.filter((c) => c.stage === 'live'), soon = all.filter((c) => c.stage !== 'live');
  return <View style={{ flex: 1 }}><AppBar title={L('Choose your area', 'اختر منطقتك')} onBack={() => router.back()} />
    <Screen top={false} gap={10}>
      <Input icon="search" placeholder={L('Search governorate or area', 'ابحث عن محافظة أو منطقة')} value={f} onChangeText={setF} />
      <Eyebrow>{L('Live now', 'متاحة الآن')}</Eyebrow>
      <View>{live.map((c) => <ListRow key={c.id} icon="map-pin" label={ar ? c.name_ar : c.name_en} chevron onPress={() => { s.set({ cityId: c.id, cityName: ar ? c.name_ar : c.name_en }); router.push('/onboarding/profile'); }} />)}</View>
      {soon.length ? <><Eyebrow>{L('Coming soon', 'قريباً')}</Eyebrow><View>{soon.map((c) => <ListRow key={c.id} label={<T role="label" color={color.textTertiary}>{ar ? c.name_ar : c.name_en}</T>} value={<Badge tone="neutral">{L('Soon', 'قريباً')}</Badge>} onPress={() => router.push({ pathname: '/waitlist', params: { city: ar ? c.name_ar : c.name_en } })} />)}</View></> : null}
    </Screen></View>;
}
