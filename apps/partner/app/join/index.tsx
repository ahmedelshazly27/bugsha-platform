// P-001 Join Bugsha as a partner. A partner account opens only with a code from the Bugsha team:
// the kitchen asks for one (here or on bugsha.app/partners), ops reviews and issues it, the code
// opens the application. Reachable signed-out; the application itself needs a session.
import { router } from 'expo-router'; import { View } from 'react-native';
import { Button, Caption, Foot, ListRow, Logo, Pp, Screen, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Join() {
  const { L, lang } = useL(); const { userId } = useSession();
  return <View style={{ flex: 1 }}><Screen gap={16}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Logo lockup="horizontal" lang={lang} size={26} color={color.brand} /><T weight={600} color={color.textSecondary}>· {L('Partner', 'الشريك')}</T></View>
    <View style={{ gap: 6 }}><T role="titleLg" weight={700}>{L('Join Bugsha as a partner', 'انضم إلى بقشة كشريك')}</T>
      <Pp>{L('Partner accounts open with a code from the Bugsha team. It arrives by email after we review your request, works once, and is yours alone.', 'حسابات الشركاء تُفتح برمز من فريق بقشة. يصلك بالبريد بعد مراجعة طلبك، يُستخدم مرة واحدة، ولك وحدك.')}</Pp></View>
    <View style={{ backgroundColor: color.raised, borderRadius: 10, borderWidth: 1, borderColor: color.borderSubtle }}>
      <ListRow icon="key" label={<T role="label" weight={600}>{L('I have a partner code', 'عندي رمز شريك')}</T>} sub={L('Enter it to open your application', 'أدخله لفتح طلب التسجيل')} chevron onPress={() => router.push('/join/code')} />
      <ListRow icon="mail" label={<T role="label" weight={600}>{L('Request a partner code', 'اطلب رمز شريك')}</T>} sub={L('Tell us about your kitchen — we reply within two working days', 'عرّفنا بمطبخك — نرد خلال يومي عمل')} chevron onPress={() => router.push('/join/request')} style={{ borderBottomWidth: 0 }} />
    </View>
    <Caption>{L('Work at a kitchen that is already on Bugsha? Ask your owner to invite this email instead — no code needed.', 'تعمل في مطبخ موجود على بقشة؟ اطلب من المالك دعوة هذا البريد — بدون رمز.')}</Caption>
  </Screen>
    <Foot>{userId ? <Button variant="ghost" fullWidth onPress={() => db.auth.signOut().then(() => router.replace('/signin'))}>{L('Sign out', 'تسجيل الخروج')}</Button> : <Button variant="ghost" fullWidth onPress={() => router.replace('/signin')}>{L('Back to sign in', 'العودة لتسجيل الدخول')}</Button>}</Foot></View>;
}
