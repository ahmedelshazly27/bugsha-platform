// P-002 Enter your partner code. Anonymous-safe check (app.check_partner_code) so the screen works
// before sign-in; a live code carries the market and the names ops recorded, which pre-fill the
// application. Deep link: bugsha-partner://signup?code=BG-XXXX-XXXX lands here with the code filled.
import { useEffect, useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useCheckPartnerCode, type PartnerCodeCheck } from '@bugsha/api';
import { AppBar, Banner, Button, Caption, Foot, Input, Pp, Screen } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useL } from '../../src/lib/ui';
const SHAPE = /^BG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
/** "bg4xb7582g" → "BG-4XB7-582G" as the user types. */
export const formatCode = (raw: string) => { const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^BG/, '').slice(0, 8); return 'BG' + (s.length ? '-' + s.slice(0, 4) : '') + (s.length > 4 ? '-' + s.slice(4) : ''); };
export default function EnterCode() {
  const { L } = useL(); const { userId } = useSession(); const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ? formatCode(String(params.code)) : ''); const [result, setResult] = useState<PartnerCodeCheck | null>(null);
  const check = useCheckPartnerCode(db);
  const copy: Record<string, [string, string, string, string]> = {
    invalid: [L("We don't recognise that code", 'ما نعرف هذا الرمز'), L('Check the email it came in — the code looks like BG-XXXX-XXXX.', 'راجع الإيميل اللي وصلك فيه — شكل الرمز BG-XXXX-XXXX.'), '', ''],
    expired: [L('This code has expired', 'انتهت صلاحية هذا الرمز'), L('Codes last 14 days. Ask the partner team for a new one — reply to the email you received.', 'الرمز صالح 14 يوماً. اطلب رمزاً جديداً من فريق الشركاء — رد على الإيميل اللي وصلك.'), '', ''],
    redeemed: [L('This code was already used', 'هذا الرمز مستخدم بالفعل'), L('If that was you, sign in with the same email to continue your setup. Otherwise contact the partner team.', 'إذا كنت أنت، سجّل الدخول بنفس البريد لإكمال الإعداد. وإلا تواصل مع فريق الشركاء.'), '', ''],
    revoked: [L('This code was withdrawn', 'سُحب هذا الرمز'), L('The partner team replaced or cancelled it. Check your email for a newer code.', 'فريق الشركاء استبدله أو ألغاه. راجع بريدك لرمز أحدث.'), '', ''],
  };
  const go = (r: PartnerCodeCheck) => { const next = { pathname: '/join/apply', params: { code: r.code, market: r.market, legal: r.legal_name ?? '', trading: r.trading_name ?? r.issued_to_name ?? '' } } as const;
    if (userId) router.push(next as any); else router.push({ pathname: '/signin', params: { next: `/join/apply?code=${encodeURIComponent(r.code ?? '')}&market=${r.market}&legal=${encodeURIComponent(r.legal_name ?? '')}&trading=${encodeURIComponent(r.trading_name ?? r.issued_to_name ?? '')}` } } as any); };
  const run = async () => { setResult(null); const r = await check.mutateAsync(code).catch(() => ({ status: 'invalid' } as PartnerCodeCheck)); setResult(r); if (r.status === 'ok') go(r); };
  useEffect(() => { if (params.code && SHAPE.test(formatCode(String(params.code)))) run(); }, []);
  return <View style={{ flex: 1 }}><AppBar title={L('Your partner code', 'رمز الشريك')} onBack={() => router.back()} /><Screen top={false} gap={14}>
    <Pp>{L('The code came by email from the Bugsha team. It works once and is tied to that email address — sign in with the same one.', 'وصلك الرمز بالبريد من فريق بقشة. يُستخدم مرة واحدة ومرتبط بذلك البريد — سجّل الدخول بنفس البريد.')}</Pp>
    <Input label={L('Partner code', 'رمز الشريك')} value={code} onChangeText={(v) => { setResult(null); setCode(formatCode(v)); }} placeholder="BG-XXXX-XXXX" autoCapitalize="characters" autoCorrect={false} autoFocus style={{ fontFamily: 'IBMPlexMono_500Medium', letterSpacing: 2 }} />
    {result && result.status !== 'ok' && copy[result.status] ? <Banner tone="error" title={copy[result.status]![0]}>{copy[result.status]![1]}</Banner> : null}
    <Caption>{L("Don't have one? Request a code from the previous screen, or on bugsha.app/partners.", 'ما عندك رمز؟ اطلبه من الشاشة السابقة أو عبر bugsha.app/partners.')}</Caption>
  </Screen><Foot><Button size="lg" fullWidth loading={check.isPending} disabled={!SHAPE.test(code)} onPress={run}>{L('Continue', 'متابعة')}</Button></Foot></View>;
}
