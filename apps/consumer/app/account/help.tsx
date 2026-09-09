// S-C-056 — help centre.
import { router } from 'expo-router'; import { Linking, View } from 'react-native';
import { AppBar, Button, Card, Caption, Eyebrow, ListRow, Screen } from '@bugsha/ui'; import { useL } from '../../src/lib/ui';
export default function Help() { const { L } = useL();
  const topics: Array<[string, string, string, string]> = [['shopping-bag', 'How surprise bags work', 'كيف تعمل البقش', '/onboarding/intro'], ['credit-card', 'Payment & refunds', 'الدفع والاسترداد', '/account/legal'], ['clock', 'Collection & windows', 'الاستلام والأوقات', '/onboarding/intro'], ['leaf', 'Food safety', 'سلامة الغذاء', '/account/safety'], ['user', 'Account', 'الحساب', '/account/profile']];
  return <View style={{ flex: 1 }}><AppBar title={L('Help', 'المساعدة')} onBack={() => router.back()} /><Screen top={false} gap={10}>
    <View>{topics.map(([i, en, a, href]) => <ListRow key={en} icon={i} label={L(en, a)} chevron onPress={() => router.push(href as any)} />)}</View>
    <Eyebrow>{L('Talk to someone', 'تحدّث إلينا')}</Eyebrow>
    <Card padded={false}><ListRow icon="info" label="WhatsApp" value={<Caption>{L('Replies in ~15 min', 'الرد خلال 15 د')}</Caption>} chevron onPress={() => Linking.openURL('https://wa.me/96500000000')} /><ListRow icon="info" label={L('Email', 'البريد')} value={<Caption>hello@bugsha.com</Caption>} chevron onPress={() => Linking.openURL('mailto:hello@bugsha.com')} /></Card>
    <Button variant="ghost" fullWidth onPress={() => router.push('/onboarding/intro')}>{L('Replay the intro', 'إعادة الشرح التعريفي')}</Button></Screen></View>; }
