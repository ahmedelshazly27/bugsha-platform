// S-C-050..058 — locale, numerals, dietary flags, impact, wallet.
import { Text } from 'react-native';
import { useImpact, useWallet, rpc } from '@bugsha/api'; import { formatMoney, money, type Currency } from '@bugsha/core'; import { t } from '@bugsha/i18n';
import { Screen, Segmented, Button } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session';
export default function Account() {
  const s = useSession(); const impact = useImpact(db) as any; const wallet = useWallet(db) as any;
  const cur = (impact.data?.currency ?? 'KWD') as Currency;
  return <Screen title={t('account.title', s.locale)}>
    <Segmented value={s.locale} onChange={(l) => { s.set({ locale: l as any }); rpc(db, 'set_locale', { p_locale: l, p_numerals: s.numerals }); }}
      options={[{ value: 'en', label: 'English' }, { value: 'ar-KW', label: 'عربي (الكويت)' }, { value: 'ar-EG', label: 'عربي (مصر)' }]} />
    <Segmented value={s.numerals} onChange={(n) => { s.set({ numerals: n as any }); rpc(db, 'set_locale', { p_locale: s.locale, p_numerals: n }); }}
      options={[{ value: 'western', label: '0-9' }, { value: 'arabic_indic', label: '٠-٩' }]} />
    {impact.data && <Text>{t('impact.saved', s.locale, { amount: formatMoney(money(impact.data.saved_minor, cur), s.locale, s.numerals), month: String(impact.data.since ?? '').slice(0, 7) })}</Text>}
    {wallet.data && <Text>{t('wallet.balance', s.locale)}: {formatMoney(money(wallet.data.balance_minor, cur), s.locale, s.numerals)}</Text>}
    <Button tone="ghost" onPress={() => db.auth.signOut()}>{t('account.sign_out', s.locale)}</Button>
  </Screen>;
}
