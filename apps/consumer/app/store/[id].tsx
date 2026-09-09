// S-C-025 — store profile: open with bags today, or paused.
import { router, useLocalSearchParams } from 'expo-router'; import { View } from 'react-native';
import { useStoreProfile, useToggleSaved, useSavedStores } from '@bugsha/api';
import { BagCard, Badge, Banner, Button, Card, CoverPlate, Icon, IconButton, Num, Pp, RatingStars, Screen, SecHead, T, color } from '@bugsha/ui';
import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session'; import { bagTitle, cdFmt, major, minutesLeft, useL, CUR } from '../../src/lib/ui';
export default function Store() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { market } = useSession(); const { L, ar } = useL(); const q = useStoreProfile(db, id!); const saved = useSavedStores(db); const toggle = useToggleSaved(db);
  const s = q.data; const isSaved = ((saved.data ?? []) as any[]).some((x) => x.store_id === id); const cur = CUR[market];
  if (!s) return <Screen><Pp>…</Pp></Screen>;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: s.timezone });
  return <View style={{ flex: 1 }}><CoverPlate category={s.category_tags?.[0]} height={170} radius={0}>
      <View style={{ position: 'absolute', top: 54, start: 8 }}><IconButton icon="arrow-left" mirror variant="solid" label={L('Back', 'رجوع')} onPress={() => router.back()} /></View>
      <View style={{ position: 'absolute', top: 54, end: 8, flexDirection: 'row', gap: 6 }}><IconButton icon="heart" variant="solid" label={L('Save store', 'حفظ المتجر')} color={isSaved ? '#C4B5FD' : '#fff'} onPress={() => toggle.mutateAsync(id!).then(() => saved.refetch())} /><IconButton icon="share-2" variant="solid" label={L('Share', 'مشاركة')} /></View></CoverPlate>
    <Screen top={false} gap={12}>
      <View style={{ gap: 6 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><T role="title" weight={700}>{s.display_name}</T><Badge tone="fresh">{L('Verified', 'موثّق')}</Badge></View>{Number(s.rating) ? <RatingStars value={Number(s.rating)} count={Number(s.rating_count)} /> : null}</View>
      {s.paused_until ? <Banner tone="time" title={L('Paused', 'متوقف مؤقتاً')}>{L('Saved stores notify you the moment they resume.', 'سنخبرك فور استئنافه إن حفظته.')}</Banner> : null}
      <Card><View style={{ gap: 8 }}><View style={{ flexDirection: 'row', gap: 8 }}><Icon name="map-pin" size={16} color={color.brand} /><T role="label" style={{ flex: 1 }}>{[s.address?.area ?? s.address?.district, s.address?.street, s.address?.governorate].filter(Boolean).join(', ')}</T></View>
        <View style={{ flexDirection: 'row', gap: 8 }}><Icon name="info" size={16} color={color.brand} /><T role="label" style={{ flex: 1 }}>{ar ? s.pickup_point_ar : s.pickup_point_en}</T></View></View></Card>
      <SecHead title={L('Tonight', 'الليلة')} />
      {(s.live_listings ?? []).length === 0 ? <Pp>{L('Nothing listed tonight yet.', 'لا شيء معروض الليلة بعد.')}</Pp> : (s.live_listings as any[]).map((l) => <BagCard key={l.listing_id} layout="row" partner={s.display_name} title={bagTitle(s.category_tags?.[0], ar)} category={s.category_tags?.[0]} priceNow={major(l.price_minor, market)} currency={cur.code} decimals={cur.dp} from={hm(l.window_start_utc)} to={hm(l.window_end_utc)} bagsLeft={l.quantity_remaining} minutesLeft={minutesLeft(l.window_end_utc) <= 60 ? minutesLeft(l.window_end_utc) : null} countdownFormat={cdFmt(ar)} onPress={() => router.push(`/listing/${l.listing_id}`)} />)}
      {(s.recent_reviews ?? []).length ? <><SecHead title={L('Reviews', 'التقييمات')} />{(s.recent_reviews as any[]).slice(0, 3).map((r, i) => <Card key={i}><View style={{ gap: 6 }}><RatingStars value={r.rating} />{r.body ? <Pp>“{r.body}”</Pp> : null}</View></Card>)}</> : null}
      <Button variant={isSaved ? 'secondary' : 'primary'} fullWidth iconStart="heart" onPress={() => toggle.mutateAsync(id!).then(() => saved.refetch())}>{isSaved ? L('Saved', 'محفوظ') : L('Save and notify me', 'احفظ ونبّهني')}</Button></Screen></View>;
}
