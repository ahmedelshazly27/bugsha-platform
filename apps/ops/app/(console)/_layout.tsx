// Ops console desk chrome: dark sidebar (partner-platform SideNav), content column capped at 1120.
import { Redirect, Slot, usePathname, router } from 'expo-router'; import { Pressable, ScrollView, View } from 'react-native';
import { Icon, Mark, T, color } from '@bugsha/ui'; import { db } from '../../src/lib/supabase'; import { useSession } from '../../src/lib/session';
const NAV = [['dashboard', 'house', 'Live'], ['partners', 'store', 'Partners'], ['orders', 'receipt', 'Orders'], ['disputes', 'triangle-alert', 'Disputes'], ['money', 'wallet', 'Money'], ['config', 'settings', 'Config'], ['jobs', 'refresh-cw', 'Jobs'], ['audit', 'file-text', 'Audit']] as const;
export default function L() { const { userId } = useSession(); const path = usePathname(); if (!userId) return <Redirect href="/signin" />;
  return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: color.canvas }}>
    <View style={{ width: 208, backgroundColor: color.inverse, paddingVertical: 16, paddingHorizontal: 10, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingBottom: 16 }}><Mark size={20} color="#fff" fold={color.inverse} foldOpacity={1} /><T role="label" weight={600} color="#fff">Bugsha · Ops</T></View>
      {NAV.map(([k, icon, label]) => { const on = path.includes(`/${k}`); return <Pressable key={k} onPress={() => router.navigate(`/(console)/${k}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8, backgroundColor: on ? 'rgba(255,255,255,.12)' : 'transparent' }}><Icon name={icon} size={16} color="#fff" /><T role="label" weight={on ? 600 : 400} color="#fff" style={{ opacity: on ? 1 : 0.68 }}>{label}</T></Pressable>; })}
      <View style={{ flex: 1 }} /><Pressable onPress={() => db.auth.signOut()} style={{ padding: 10 }}><T role="caption" color="rgba(255,255,255,.55)">Sign out</T></Pressable></View>
    <ScrollView contentContainerStyle={{ padding: 24, maxWidth: 1120, width: '100%', gap: 14 }}><Slot /></ScrollView></View>; }
