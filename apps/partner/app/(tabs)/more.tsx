// More — money (owner/accountant), cash liability (always visible when it exists), language, branch, sign out.
import { View } from 'react-native'; import { router } from 'expo-router';
import { useAnalytics, useCashLiability, usePayouts } from '@bugsha/api'; import { can } from '@bugsha/core';
import { AppBar, Banner, Caption, Eyebrow, ListRow, Num, PartnerStat, PayoutCard, Screen, SegmentedControl, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { useStore } from '../../src/lib/store'; import { major, money, useL, CUR } from '../../src/lib/ui';
export default function More() {
  const s = useStore(); const sess = useSession(); const { L, ar } = useL(); const owner = can(s.role, 'viewPayouts');
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
  const pay = usePayouts(db, s.partnerId) as any; const cash = useCashLiability(db, s.partnerId) as any; const an = useAnalytics(db, s.partnerId, from, to) as any;
  return <View style={{ flex: 1 }}><AppBar title={L('More', 'المزيد')} back={false} />
    <Screen top={false} gap={12}>
      {owner ? <>
        <View style={{ flexDirection: 'row', gap: 10 }}><PartnerStat label={L('Gross · 30 days', 'الإجمالي · 30 يوماً')} value={money(an.data?.gross_minor ?? 0, s.market)} icon="banknote" /><PartnerStat label={L('Bags sold', 'البقش المباعة')} value={String(an.data?.bags_sold ?? an.data?.orders ?? 0)} icon="package" /></View>
        {cash.data?.receivable_minor > 0 ? <Banner tone="time" title={L(`Cash commission owed: ${money(cash.data.receivable_minor, s.market)}`, `عمولة النقد المستحقة: ${money(cash.data.receivable_minor, s.market)}`)}>{L('Invoiced monthly. Pay by the due date to keep listings live.', 'تُفوتر شهرياً. ادفع قبل الاستحقاق لإبقاء العروض نشطة.')}</Banner> : null}
        <Eyebrow>{L('Payouts', 'المدفوعات')}</Eyebrow>
        {((pay.data ?? []) as any[]).slice(0, 4).map((p) => <PayoutCard key={p.payout_id} onPress={() => router.push(`/money/${p.payout_id}`)} amount={major(p.net_minor, s.market)} currency={CUR[s.market].code} decimals={CUR[s.market].dp} period={`${p.period_start} → ${p.period_end}`} note={`${p.status}${p.hold_reason ? ' · ' + p.hold_reason : ''}${p.carry_out_minor > 0 ? ' · ' + L('carries forward', 'يُرحّل') : ''}`} />)}
        {(pay.data ?? []).length === 0 ? <Caption>{L('No payout runs yet.', 'لا دفعات بعد.')}</Caption> : null}
      </> : <Banner tone="info" title={L('Money is visible to the owner and accountant', 'المبالغ تظهر للمالك والمحاسب')} />}
      <Eyebrow>{L('Manage', 'إدارة')}</Eyebrow>
      <View>{owner ? <><ListRow icon="banknote" label={L('Cash — end of day', 'النقد — نهاية اليوم')} chevron onPress={() => router.push('/money/cash')} /><ListRow icon="user" label={L('Staff', 'الفريق')} chevron onPress={() => router.push('/org/staff')} /><ListRow icon="chart-column" label={L('Analytics', 'التحليلات')} chevron onPress={() => router.push('/org/analytics')} /></> : null}
        <ListRow icon="star" label={L('Reviews', 'التقييمات')} chevron onPress={() => router.push('/org/reviews')} /><ListRow icon="file-text" label={L('Inspection log', 'سجل التفتيش')} chevron onPress={() => router.push('/org/ledger')} /><ListRow icon="package" label={L('Bag templates', 'قوالب البقش')} chevron onPress={() => router.push('/templates')} /><ListRow icon="calendar" label={L('Schedules', 'الجداول')} sub={L('Auto-publish on set days', 'نشر تلقائي في أيام محددة')} chevron onPress={() => router.push('/org/schedules')} /><ListRow icon="shield-check" label={L('Quality', 'الجودة')} sub={L('Flags and customer reports', 'التنبيهات وبلاغات العملاء')} chevron onPress={() => router.push('/org/quality')} /><ListRow icon="store" label={L('Branches', 'الفروع')} sub={L('Pause, hours, add a branch', 'إيقاف، ساعات، إضافة فرع')} chevron onPress={() => router.push('/org/branch')} /><ListRow icon="settings" label={L('Setup & documents', 'الإعداد والوثائق')} chevron onPress={() => router.push('/onboarding')} /><ListRow icon="info" label={L('Help & training', 'المساعدة والتدريب')} chevron onPress={() => router.push('/support')} /></View>
      <Eyebrow>{L('Settings', 'الإعدادات')}</Eyebrow>
      <View><ListRow icon="settings" label={L('App language', 'لغة التطبيق')} value={<SegmentedControl fullWidth={false} value={ar ? 'ar' : 'en'} onChange={(v) => sess.set({ locale: v === 'en' ? 'en' : s.market === 'KW' ? 'ar-KW' : 'ar-EG' })} options={[{ value: 'ar', label: 'ع' }, { value: 'en', label: 'EN' }]} />} />
        <ListRow icon="store" label={L('Switch branch', 'تبديل الفرع')} value={<Caption>{s.storeName}</Caption>} chevron onPress={() => s.clear()} />
        <ListRow icon="arrow-left" label={L('Sign out', 'تسجيل الخروج')} onPress={() => { s.clear(); db.auth.signOut(); }} /></View></Screen></View>;
}
