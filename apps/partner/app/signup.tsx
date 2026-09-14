// Deep link target: bugsha-partner://signup?code=BG-XXXX-XXXX (the button in the partner-code email).
import { Redirect, useLocalSearchParams } from 'expo-router';
export default function Signup() { const { code } = useLocalSearchParams<{ code?: string }>(); return <Redirect href={{ pathname: '/join/code', params: code ? { code } : {} } as any} />; }
