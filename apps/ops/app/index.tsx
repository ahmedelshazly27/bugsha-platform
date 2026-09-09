import { Redirect } from 'expo-router'; import { useSession } from '../src/lib/session';
export default function I() { const { userId } = useSession(); return <Redirect href={userId ? '/(console)/dashboard' : '/signin'} />; }
