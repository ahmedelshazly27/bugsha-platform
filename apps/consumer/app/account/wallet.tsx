// S-C-053 — wallet & credit, with expiry. Goodwill credit lasts 90 days; refund credit never expires.
import { router } from 'expo-router'; import { View } from 'react-native';
import { useWallet } from '@bugsha/api'; import { AppBar, Banner, Caption, Card, Eyebrow, ListRow, Num, Screen } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { money, useL } from '../../src/lib/ui';
export default function Wallet() { const { market } = useSession(); const { L } = useL(); const q = useWallet(db) as any; const w = q.data ?? {};
  return <View style={{ flex: 1 }}><AppBar title={L('Wallet', 'المحفظة')} onBack={() => router.back()} /><Screen top={false} pad={16} gap={12}>
    <Card><View style={{ gap: 4 }}><Eyebrow>{L('Balance', 'الرصيد')}</Eyebrow><Num weight={700} style={{ fontSize: 32, lineHeight: 38 }}>{money(w.balance_minor ?? 0, market)}</Num><Caption>{L('Applied automatically at checkout.', 'يُطبّق تلقائياً عند الدفع.')}</Caption></View></Card>
    {w.expiring_soon_minor > 0 ? <Banner tone="time" title={L(`${money(w.expiring_soon_minor, market)} expires within 30 days`, `${money(w.expiring_soon_minor, market)} ينتهي خلال 30 يوماً`)}>{L('Goodwill credit lasts 90 days. Refund credit never expires.', 'رصيد التعويض يستمر 90 يوماً. رصيد الاسترداد لا ينتهي.')}</Banner> : null}
    <Eyebrow>{L('History', 'السجل')}</Eyebrow>{(w.recent ?? []).length === 0 ? <Caption>{L('No credit movements yet.', 'لا حركات بعد.')}</Caption> : (w.recent as any[]).map((t, i) => <ListRow key={i} icon={t.amount_minor > 0 ? 'plus' : 'minus'} label={t.reason ?? t.kind} value={<Num role="label">{money(t.amount_minor, market)}</Num>} />)}</Screen></View>; }
