// S-P-030..034 — payouts, cash liability (Egypt: always visible), statements. Owner/accountant only.
import { Text } from 'react-native'; import { usePayouts, useCashLiability, useAnalytics } from '@bugsha/api'; import { formatMoney, money, can, type Currency } from '@bugsha/core';
import { Screen, Stat, ListRow, Notice } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useStore } from '../../src/lib/store';
export default function Money() {
  const { partnerId, role } = useStore(); const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10); const to = new Date().toISOString().slice(0, 10);
  const pay = usePayouts(db, partnerId) as any; const cash = useCashLiability(db, partnerId) as any; const an = useAnalytics(db, partnerId, from, to) as any;
  if (!can(role, 'viewPayouts')) return <Screen title="Money"><Notice>Payouts are visible to the owner and accountant.</Notice></Screen>;
  const cur = (an.data?.currency ?? 'KWD') as Currency;
  return <Screen title="Money">
    {an.data && <Stat label="Gross (30d)" value={formatMoney(money(an.data.gross_minor, cur), 'en', 'western')} />}
    {cash.data?.receivable_minor > 0 && <Notice tone="warn">Cash commission owed: {formatMoney(money(cash.data.receivable_minor, cur), 'en', 'western')} — settled by {cash.data.settlement_mode}</Notice>}
    {pay.data?.map((p: any) => <ListRow key={p.payout_id} title={formatMoney(money(p.net_minor, p.currency as Currency), 'en', 'western')} subtitle={`${p.status}${p.hold_reason ? ' · ' + p.hold_reason : ''}${p.carry_out_minor > 0 ? ' · carries forward' : ''}`} />)}
  </Screen>;
}
