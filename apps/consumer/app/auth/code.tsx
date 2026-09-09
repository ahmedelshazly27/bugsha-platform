// S-C-012 — six boxes, resend timer, honest error copy.
import { useEffect, useRef, useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { Pressable, TextInput, View } from 'react-native';
import { AppBar, Banner, Button, Caption, Foot, Num, Pp, Screen, T, color, radius } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
export default function Code() {
  const { email } = useLocalSearchParams<{ email: string }>(); const { L } = useL(); const set = useSession((s) => s.set);
  const [code, setCode] = useState(''); const [err, setErr] = useState(false); const [left, setLeft] = useState(60); const ref = useRef<TextInput>(null);
  useEffect(() => { const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000); return () => clearInterval(id); }, []);
  async function verify(v: string) {
    const { data, error } = await db.auth.verifyOtp({ email: email!, token: v, type: 'email' });
    if (error || !data.session) return setErr(true);
    set({ userId: data.session.user.id }); router.replace('/onboarding/market');
  }
  return <View style={{ flex: 1 }}><AppBar title={L('Enter your code', 'أدخل الرمز')} onBack={() => router.back()} />
    <Screen top={false} pad={16} gap={16}>
      <Pp>{L('Sent to ', 'أُرسل إلى ')}<Num role="label" color={color.textSecondary}>{email}</Num>. <T role="label" color={color.link} onPress={() => router.back()}>{L('Wrong address?', 'البريد غير صحيح؟')}</T></Pp>
      <Pressable onPress={() => ref.current?.focus()} style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', direction: 'ltr' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ width: 44, height: 56, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: color.raised, borderWidth: 1.5, borderColor: err ? color.error : i < code.length ? color.brand : color.border }}>
          <Num role="title" weight={700} color={err ? color.error : color.text}>{code[i] ?? ''}</Num></View>)}
        <TextInput ref={ref} value={code} onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); setErr(false); if (d.length === 6) verify(d); }} keyboardType="number-pad" textContentType="oneTimeCode" autoFocus maxLength={6} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} /></Pressable>
      {err ? <Banner tone="error" title={L("That code didn't match", 'الرمز غير مطابق')}>{L('Check the latest email and try again.', 'تحقق من آخر رسالة وحاول مرة أخرى.')}</Banner>
        : <Caption align="center">{left > 0 ? <>{L('Resend in ', 'إعادة الإرسال بعد ')}<Num role="caption" color={color.textSecondary}>{`0:${String(left).padStart(2, '0')}`}</Num></> : L('Code not arrived? Check spam, then resend.', 'لم يصل الرمز؟ تحقق من البريد المزعج ثم أعد الإرسال.')}</Caption>}
    </Screen>
    <Foot><Button variant="ghost" fullWidth disabled={left > 0} onPress={async () => { await db.auth.signInWithOtp({ email: email! }); setLeft(60); setCode(''); setErr(false); }}>{L('Resend code', 'إعادة إرسال الرمز')}</Button></Foot></View>;
}
