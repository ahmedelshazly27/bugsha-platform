import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createBugshaClient } from '@bugsha/api';

// SecureStore on device; localStorage on web. Nothing provider-related ever lives here.
const storage = Platform.OS === 'web'
  ? { getItem: async (k: string) => globalThis.localStorage?.getItem(k) ?? null, setItem: async (k: string, v: string) => { globalThis.localStorage?.setItem(k, v); }, removeItem: async (k: string) => { globalThis.localStorage?.removeItem(k); } }
  : { getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync, removeItem: SecureStore.deleteItemAsync };

export const db = createBugshaClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, storage);
