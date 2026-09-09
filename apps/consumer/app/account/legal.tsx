// S-C-058 — per market, dated.
import { router } from 'expo-router'; import { Linking, View } from 'react-native';
import { AppBar, Caption, ListRow, Num, Screen, T } from '@bugsha/ui'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Legal() { const { market } = useSession(); const { L } = useL();
  const docs: Array<[string, string, string, string]> = [['Terms of service', 'شروط الخدمة', '2026-09-09', 'terms'], ['Privacy policy', 'سياسة الخصوصية', '2026-09-09', 'privacy'], ['Refund & cancellation policy', 'سياسة الاسترداد والإلغاء', '2026-09-09', 'refunds'], [market === 'KW' ? 'Kuwait consumer rights notice' : 'Egypt consumer protection notice', market === 'KW' ? 'إشعار حقوق المستهلك — الكويت' : 'إشعار حماية المستهلك — مصر', '2026-09-09', 'consumer']];
  return <View style={{ flex: 1 }}><AppBar title={L('Legal', 'الوثائق القانونية')} onBack={() => router.back()} /><Screen top={false} gap={0}>
    {docs.map(([en, a, d, slug]) => <ListRow key={slug} icon="file-text" label={<T role="label" weight={500}>{L(en, a)}</T>} sub={<View style={{ flexDirection: 'row', gap: 4 }}><Caption>{L('Updated', 'حُدّثت')}</Caption><Num role="caption" color="#9A94A8">{d}</Num></View>} chevron onPress={() => Linking.openURL(`https://bugsha.com/legal/${slug}?market=${market.toLowerCase()}`)} />)}</Screen></View>; }
