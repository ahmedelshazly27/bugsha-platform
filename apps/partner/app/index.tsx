import { Redirect } from 'expo-router'; import { useSession } from '../src/lib/session';
export default function Index() { const { userId } = useSession(); return <Redirect href={userId ? '/(tabs)' : '/signin'} />; }
