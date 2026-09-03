// Expo inlines EXPO_PUBLIC_* at build time; this is the only `process` the apps touch.
declare const process: { env: { EXPO_PUBLIC_SUPABASE_URL?: string; EXPO_PUBLIC_SUPABASE_ANON_KEY?: string } };
