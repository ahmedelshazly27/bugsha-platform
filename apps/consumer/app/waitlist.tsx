// S-C-005 — city not yet live. One message when the first bags go live, then we stop. Posts to the same
// waitlist as bugsha.app, with the city as the area.
import { useState } from 'react'; import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { AppBar, Banner, Button, Icon, Input, Pp, Rule, Screen, T, color } from '@bugsha/ui'; import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { useL } from '../src/lib/ui';
const ENDPOINT = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/waitlist-signup`;
export default function Waitlist() {
  const params = useLocalSearchParams<{ city?: string }>(); const { L } = useL(); const { userId, locale, market, cityName } = useSession(); const city = params.city || cityName || (market === 'KW' ? L('Kuwait', 'الكويت') : L('Egypt', 'مصر'));
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ position?: number | null; already?: boolean } | null>(null); const [err, setErr] = useState<string | null>(null);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const join = async () => { setBusy(true); setErr(null); try {
      let addr = email.trim().toLowerCase(); if (!addr && userId) { const { data } = await db.auth.getUser(); addr = data.user?.email ?? ''; }
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr, area: `${market === 'KW' ? 'Kuwait' : 'Egypt'} · ${city}`, source: 'consumer-app', locale }) });
      const b = await res.json().catch(() => ({ ok: res.ok })); if (!b?.ok) throw new Error(b?.error || 'failed'); setDone({ position: b.position, already: b.alreadyOnList });
    } catch (e) { setErr(e instanceof Error && e.message !== 'failed' ? e.message : L("We couldn't save that just now. Try again.", 'تعذّر الحفظ الآن. حاول مرة أخرى.')); } finally { setBusy(false); } };
  return <View style={{ flex: 1 }}><AppBar title={String(city)} onBack={() => router.back()} />
    <Screen top={false} pad={18} gap={14}><Icon name="map-pin" size={30} color={color.brand} />
      <View style={{ gap: 6 }}><T role="titleLg" weight={700}>{L(`We're not in ${city} yet`, `لسنا في ${city} بعد`)}</T>
        <Pp>{L("No partners here so far. We'll tell you the day the first bags go live — nothing else.", 'لا يوجد شركاء هنا حتى الآن. سنخبرك يوم توفر أول البقش — لا شيء غير ذلك.')}</Pp></View>
      {done ? <Banner tone="fresh" title={done.already ? L("You're already on the list", 'أنت على القائمة بالفعل') : L("You're on the list", 'أنت على القائمة')}>{done.position ? L(`#${done.position} in line. One email when ${city} opens.`, `رقمك ${done.position}. رسالة واحدة عند افتتاح ${city}.`) : L(`One email when ${city} opens.`, `رسالة واحدة عند افتتاح ${city}.`)}</Banner> : <>
        {!userId ? <Input label={L('Email', 'البريد الإلكتروني')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /> : null}
        {err ? <Banner tone="error" title={err} /> : null}
        <Button fullWidth loading={busy} disabled={!userId && !valid} onPress={join}>{L('Notify me at launch', 'أبلغني عند الإطلاق')}</Button></>}<Rule />
      <Button variant="ghost" fullWidth iconEnd="arrow-right" onPress={() => router.back()}>{L('Browse another area instead', 'تصفّح منطقة أخرى بدلاً من ذلك')}</Button></Screen></View>;
}
