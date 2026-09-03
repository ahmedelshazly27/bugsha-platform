import { Tabs } from 'expo-router';
export default function L() { return <Tabs screenOptions={{ headerShown: false }}>
  <Tabs.Screen name="index" options={{ title: 'Today' }} /><Tabs.Screen name="redeem" options={{ title: 'Redeem' }} />
  <Tabs.Screen name="listings" options={{ title: 'Listings' }} /><Tabs.Screen name="money" options={{ title: 'Money' }} /></Tabs>; }
