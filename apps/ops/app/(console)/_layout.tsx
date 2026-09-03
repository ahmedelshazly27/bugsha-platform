import { Slot, Link } from 'expo-router'; import { View, Text } from 'react-native';
const NAV = [['dashboard','Live'],['partners','Partners'],['orders','Orders'],['disputes','Disputes'],['money','Money'],['config','Config'],['jobs','Jobs'],['audit','Audit']];
export default function L() { return <View style={{ flexDirection: 'row', minHeight: '100%' }}>
  <View style={{ width: 200, padding: 16, gap: 8 }}>{NAV.map(([p, l]) => <Link key={p} href={`/(console)/${p}`}><Text>{l}</Text></Link>)}</View>
  <View style={{ flex: 1, padding: 24 }}><Slot /></View></View>; }
