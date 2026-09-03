import { Text } from 'react-native'; import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@bugsha/ui';
export default function Waitlist() { const { city } = useLocalSearchParams<{ city: string }>(); return <Screen title={String(city)}><Text>Not open yet. We'll tell you the day it is.</Text></Screen>; }
