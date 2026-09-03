import { Tabs } from 'expo-router';
export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false }}>
    <Tabs.Screen name="index" options={{ title: 'Browse' }} />
    <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
    <Tabs.Screen name="account" options={{ title: 'Account' }} />
  </Tabs>;
}
