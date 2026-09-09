// S-C-054 — referral. Credited on the friend's first collected bag, not on sign-up.
import { router } from 'expo-router'; import { Share, View } from 'react-native';
import { AppBar, Button, Card, Eyebrow, Num, Pp, Screen, T } from '@bugsha/ui'; import { useSession } from '../../src/lib/session'; import { money, useL } from '../../src/lib/ui';
export default function Invite() { const { userId, market } = useSession(); const { L } = useL(); const code = 'BQ-' + (userId ?? '').replace(/-/g, '').slice(0, 6).toUpperCase(); const reward = money(market === 'KW' ? 1000 : 5000, market);
  return <View style={{ flex: 1 }}><AppBar title={L('Invite a friend', 'ادعُ صديقاً')} onBack={() => router.back()} /><Screen top={false} pad={16} gap={14}>
    <View style={{ gap: 6 }}><T role="titleLg" weight={700}>{L(`Both of you get ${reward}`, `كلاكما يحصل على ${reward}`)}</T><Pp>{L('They get it on their first collected bag. You get it the moment they collect — not when they sign up.', 'يحصل عليه عند أول بقشة يستلمها. وتحصل عليه أنت عند استلامه — لا عند التسجيل.')}</Pp></View>
    <Card><View style={{ alignItems: 'center', gap: 8 }}><Eyebrow>{L('Your code', 'رمزك')}</Eyebrow><Num weight={700} tracking={3} style={{ fontSize: 26, lineHeight: 32 }}>{code}</Num></View></Card>
    <Button fullWidth iconStart="share-2" onPress={() => Share.share({ message: L(`Get ${reward} off your first Bugsha bag with my code ${code}`, `خذ ${reward} على أول بقشة برمزي ${code}`) })}>{L('Share', 'مشاركة')}</Button>
    <Pp>{L('Referral credit is issued by Bugsha support once your friend collects. Codes go live with the referral programme.', 'يُصرف رصيد الدعوة من دعم بقشة بعد استلام صديقك. تُفعّل الرموز مع إطلاق برنامج الدعوات.')}</Pp></Screen></View>; }
