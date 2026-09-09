// S-C-055 — granular + quiet hours. Order updates can't be switched off.
import { useEffect, useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useNotificationPrefs, useSetNotificationPrefs } from '@bugsha/api';
import { AppBar, Caption, Card, ListRow, Num, Screen, Switch } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useL } from '../../src/lib/ui';
export default function Notifs() { const { L } = useL(); const q = useNotificationPrefs(db); const m = useSetNotificationPrefs(db); const [c, setC] = useState<Record<string, boolean>>({});
  useEffect(() => { if (q.data?.categories) setC(q.data.categories); }, [q.data]);
  const upd = (k: string, v: boolean) => { const n = { ...c, [k]: v }; setC(n); m.mutate({ categories: n, quietFrom: q.data?.quiet_from ?? '00:30', quietTo: q.data?.quiet_to ?? '09:00' }); };
  return <View style={{ flex: 1 }}><AppBar title={L('Notifications', 'الإشعارات')} onBack={() => router.back()} /><Screen top={false} gap={10}>
    <Card padded={false}><ListRow icon="receipt" label={L('Order updates', 'تحديثات الطلب')} value={<Caption>{L('Always on', 'دائماً')}</Caption>} /></Card>
    <Caption style={{ paddingHorizontal: 4 }}>{L("Confirmations, cancellations and refunds can't be switched off — you need them.", 'التأكيدات والإلغاءات والاستردادات لا يمكن إيقافها — أنت بحاجة إليها.')}</Caption>
    <Card padded={false}><ListRow icon="clock" label={L('Pickup reminder', 'تذكير الاستلام')} value={<Switch checked={c.pickup_reminder !== false} onChange={(v) => upd('pickup_reminder', v)} label={L('Pickup reminder', 'تذكير الاستلام')} />} />
      <ListRow icon="heart" label={L('Saved stores list', 'متاجرك تعرض')} value={<Switch checked={!!c.saved_stores} onChange={(v) => upd('saved_stores', v)} label={L('Saved stores', 'المتاجر المحفوظة')} />} />
      <ListRow icon="map-pin" label={L('Nearby bags', 'بقش قريبة')} value={<Switch checked={!!c.nearby} onChange={(v) => upd('nearby', v)} label={L('Nearby', 'قريبة')} />} />
      <ListRow icon="package" label={L('Campaigns', 'الحملات')} value={<Switch checked={!!c.campaigns} onChange={(v) => upd('campaigns', v)} label={L('Campaigns', 'الحملات')} />} /></Card>
    <Card padded={false}><ListRow icon="moon" label={L('Quiet hours', 'ساعات الهدوء')} value={<Num role="label" color="#6B6579">{`${String(q.data?.quiet_from ?? '00:30').slice(0, 5)} – ${String(q.data?.quiet_to ?? '09:00').slice(0, 5)}`}</Num>} /></Card></Screen></View>; }
