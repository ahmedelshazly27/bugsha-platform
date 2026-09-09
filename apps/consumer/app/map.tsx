// S-C-022 — map view: price-bubble pins, selected pin opens a row card. Sold-out pins stay visible but muted.
import { useState } from 'react'; import { router } from 'expo-router'; import { View } from 'react-native'; import MapView, { Marker } from 'react-native-maps';
import { useNearby } from '@bugsha/api';
import { BagCard, Button, Card, IconButton, MapPin, Pp, T, color } from '@bugsha/ui';
import { db } from '../src/lib/supabase'; import { useSession } from '../src/lib/session'; import { bagTitle, cdFmt, major, minutesLeft, useL, CUR } from '../src/lib/ui';
const CENTRE: Record<string, { latitude: number; longitude: number }> = { KW: { latitude: 29.34, longitude: 48.03 }, EG: { latitude: 30.06, longitude: 31.22 } };
export default function Map() {
  const { market, lat, lng } = useSession(); const { L, ar } = useL(); const c = lat && lng ? { latitude: lat, longitude: lng } : CENTRE[market]!;
  const [region, setRegion] = useState({ ...c, latitudeDelta: 0.08, longitudeDelta: 0.08 }); const [sel, setSel] = useState<any>(null);
  const q = useNearby(db, region.latitude, region.longitude, 8000); const rows = (q.data ?? []) as any[]; const cur = CUR[market];
  return <View style={{ flex: 1 }}>
    <MapView style={{ flex: 1 }} initialRegion={region} onRegionChangeComplete={setRegion} showsUserLocation>
      {rows.map((r: any) => { const loc = r.location ?? {}; const coords = loc.coordinates ?? [loc.lng ?? loc.x, loc.lat ?? loc.y]; if (!coords?.[0]) return null; return <Marker key={r.listing_id} coordinate={{ latitude: coords[1], longitude: coords[0] }} onPress={() => setSel(r)}><MapPin price={major(r.price_minor, market)} currency={cur.code} decimals={cur.dp} selected={sel?.listing_id === r.listing_id} soldOut={r.quantity_remaining <= 0} /></Marker>; })}
    </MapView>
    <View style={{ position: 'absolute', top: 54, start: 12 }}><IconButton icon="arrow-left" mirror variant="solid" label={L('Back', 'رجوع')} onPress={() => router.back()} /></View>
    <View style={{ position: 'absolute', top: 54, alignSelf: 'center' }}><Button variant="secondary" size="sm" iconStart="refresh-cw" onPress={() => q.refetch()}>{L('Search this area', 'ابحث في هذه المنطقة')}</Button></View>
    <View style={{ position: 'absolute', bottom: sel ? 200 : 34, end: 12, gap: 8 }}><IconButton icon="navigation" variant="solid" label={L('Recentre', 'إعادة التمركز')} onPress={() => setRegion({ ...c, latitudeDelta: 0.05, longitudeDelta: 0.05 })} /><IconButton icon="list" variant="solid" label={L('List view', 'عرض القائمة')} onPress={() => router.back()} /></View>
    {rows.length === 0 && !q.isLoading ? <View style={{ position: 'absolute', top: 120, left: 24, right: 24 }}><Card><View style={{ gap: 8, alignItems: 'center' }}><T weight={600}>{L('No bags in this area', 'لا توجد بقش هنا')}</T><Pp>{L('Pan the map or widen your search to see the nearest partners.', 'حرّك الخريطة أو وسّع البحث لرؤية أقرب الشركاء.')}</Pp></View></Card></View> : null}
    {sel ? <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: color.raised, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 34, gap: 12 }}>
      <BagCard layout="row" partner={sel.store_name} title={bagTitle(sel.category, ar)} category={sel.category} priceNow={major(sel.price_minor, market)} priceWas={sel.value_min_minor ? major(sel.value_min_minor, market) : null} currency={cur.code} decimals={cur.dp} from={new Date(sel.window_start_utc).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} to={new Date(sel.window_end_utc).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} distanceKm={sel.distance_m != null ? sel.distance_m / 1000 : null} bagsLeft={sel.quantity_remaining} rating={Number(sel.rating) || null} minutesLeft={minutesLeft(sel.window_end_utc) <= 60 ? minutesLeft(sel.window_end_utc) : null} countdownFormat={cdFmt(ar)} onPress={() => router.push(`/listing/${sel.listing_id}`)} />
      <Button fullWidth iconEnd="arrow-right" onPress={() => router.push(`/listing/${sel.listing_id}`)}>{L('See this bag', 'عرض البقشة')}</Button></View> : null}
  </View>;
}
