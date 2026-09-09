// S-C-005 — city not yet live. One message, then we stop.
import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { AppBar, Button, Icon, Pp, Rule, Screen, T, color } from '@bugsha/ui'; import { useL } from '../src/lib/ui';
export default function Waitlist() {
  const { city } = useLocalSearchParams<{ city: string }>(); const { L } = useL();
  return <View style={{ flex: 1 }}><AppBar title={String(city)} onBack={() => router.back()} />
    <Screen top={false} pad={18} gap={14}><Icon name="map-pin" size={30} color={color.brand} />
      <View style={{ gap: 6 }}><T role="titleLg" weight={700}>{L(`We're not in ${city} yet`, `لسنا في ${city} بعد`)}</T>
        <Pp>{L("No partners here so far. We'll tell you the day the first bags go live — nothing else.", 'لا يوجد شركاء هنا حتى الآن. سنخبرك يوم توفر أول البقش — لا شيء غير ذلك.')}</Pp></View>
      <Button fullWidth onPress={() => router.back()}>{L('Notify me at launch', 'أبلغني عند الإطلاق')}</Button><Rule />
      <Button variant="ghost" fullWidth iconEnd="arrow-right" onPress={() => router.back()}>{L('Browse another area instead', 'تصفّح منطقة أخرى بدلاً من ذلك')}</Button></Screen></View>;
}
