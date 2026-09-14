// S-C-041 — granular categories, quiet hours you can actually set, channels. Order updates can't be switched off.
import { useEffect, useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native';
import { useNotificationPrefs, useSetNotificationPreferences } from '@bugsha/api';
import { AppBar, Banner, Button, Caption, Card, Chip, Chips, Eyebrow, Foot, Input, ListRow, Screen, Switch } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useL } from '../../src/lib/ui';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export default function Notifs() { const { L } = useL(); const q = useNotificationPrefs(db); const m = useSetNotificationPreferences(db);
  const [c, setC] = useState<Record<string, boolean>>({ pickup_reminder: true, order_updates: true, saved_stores: true, nearby: false, campaigns: false }); const [from, setFrom] = useState('00:30'); const [to, setTo] = useState('09:00'); const [channels, setChannels] = useState<string[]>(['push']); const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) { if (q.data.categories) setC({ ...c, ...q.data.categories }); if (q.data.quiet_from) setFrom(String(q.data.quiet_from).slice(0, 5)); if (q.data.quiet_to) setTo(String(q.data.quiet_to).slice(0, 5)); if (Array.isArray(q.data.channels) && q.data.channels.length) setChannels(q.data.channels); } }, [q.data]);
  const valid = TIME.test(from) && TIME.test(to) && channels.length > 0;
  const save = () => m.mutateAsync({ categories: { ...c, order_updates: true }, quietFrom: from, quietTo: to, channels }).then(() => { setSaved(true); q.refetch(); });
  const row = (k: string, icon: string, en: string, a: string) => <ListRow key={k} icon={icon} label={L(en, a)} value={<Switch checked={c[k] !== false} onChange={(v) => { setSaved(false); setC({ ...c, [k]: v }); }} label={L(en, a)} />} />;
  return <View style={{ flex: 1 }}><AppBar title={L('Notifications', 'الإشعارات')} onBack={() => router.back()} /><Screen top={false} gap={10}>
    <Card padded={false}><ListRow icon="receipt" label={L('Order updates', 'تحديثات الطلب')} value={<Caption>{L('Always on', 'دائماً')}</Caption>} /></Card>
    <Caption style={{ paddingHorizontal: 4 }}>{L("Confirmations, cancellations and refunds can't be switched off — you need them.", 'التأكيدات والإلغاءات والاستردادات لا يمكن إيقافها — أنت بحاجة إليها.')}</Caption>
    <Card padded={false}>{row('pickup_reminder', 'clock', 'Pickup reminder', 'تذكير الاستلام')}{row('saved_stores', 'heart', 'Saved stores list', 'متاجرك تعرض')}{row('nearby', 'map-pin', 'Nearby bags', 'بقش قريبة')}{row('campaigns', 'package', 'Campaigns', 'الحملات')}</Card>
    <Eyebrow>{L('Quiet hours', 'ساعات الهدوء')}</Eyebrow>
    <View style={{ flexDirection: 'row', gap: 8 }}><Input containerStyle={{ flex: 1 }} label={L('From', 'من')} value={from} onChangeText={(v) => { setSaved(false); setFrom(v); }} placeholder="00:30" keyboardType="numbers-and-punctuation" error={TIME.test(from) ? undefined : L('Use HH:MM', 'استخدم HH:MM')} /><Input containerStyle={{ flex: 1 }} label={L('To', 'إلى')} value={to} onChangeText={(v) => { setSaved(false); setTo(v); }} placeholder="09:00" keyboardType="numbers-and-punctuation" error={TIME.test(to) ? undefined : L('Use HH:MM', 'استخدم HH:MM')} /></View>
    <Caption>{L('Nothing but order updates between these hours. A bag reserved for a morning window still gets its reminder.', 'لا شيء سوى تحديثات الطلب في هذه الساعات. البقشة المحجوزة لوقت صباحي تظل تحصل على تذكيرها.')}</Caption>
    <Eyebrow>{L('Channels', 'القنوات')}</Eyebrow>
    <Chips>{([['push', 'Push', 'إشعارات'], ['email', 'Email', 'بريد'], ['sms', 'SMS', 'رسائل نصية']] as const).map(([k, en, a]) => <Chip key={k} selected={channels.includes(k)} onPress={() => { setSaved(false); setChannels(channels.includes(k) ? channels.filter((x) => x !== k) : [...channels, k]); }}>{L(en, a)}</Chip>)}</Chips>
    {channels.length === 0 ? <Banner tone="error" title={L('Keep at least one channel', 'أبقِ قناة واحدة على الأقل')} /> : null}
    {saved ? <Banner tone="fresh" title={L('Saved', 'تم الحفظ')} /> : null}</Screen>
    <Foot><Button size="lg" fullWidth disabled={!valid} loading={m.isPending} onPress={save}>{L('Save', 'حفظ')}</Button></Foot></View>; }
