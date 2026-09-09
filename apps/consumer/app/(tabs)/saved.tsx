// S-C-027 — saved stores. Empty state until store-saving ships server-side.
import { router } from 'expo-router'; import { View } from 'react-native';
import { AppBar, EmptyState, Screen } from '@bugsha/ui'; import { useL } from '../../src/lib/ui';
export default function Saved() { const { L } = useL(); return <View style={{ flex: 1 }}><AppBar title={L('Saved stores', 'المتاجر المحفوظة')} back={false} />
  <Screen top={false} scroll={false} style={{ justifyContent: 'center' }}><EmptyState icon="heart" title={L('Save the stores you like', 'احفظ متاجرك المفضلة')} body={L('Good bags go in minutes. Saved stores can ping you the second they list, before the feed fills up.', 'البقش الجيدة تنفد خلال دقائق. المتاجر المحفوظة تنبّهك فور عرضها قبل امتلاء القائمة.')} actionLabel={L("Browse tonight's bags", 'تصفّح بقش الليلة')} onAction={() => router.navigate('/(tabs)')} /></Screen></View>; }
