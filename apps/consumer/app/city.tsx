// S-C-004/005 — city selection; a waitlist city routes to the waitlist screen.
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useCities, useCompleteProfile } from '@bugsha/api';
import { Screen, ListRow, Button } from '@bugsha/ui';
import { db } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';
import { useState } from 'react';

export default function City() {
  const { market, locale, set } = useSession();
  const cities = useCities(db, market); const complete = useCompleteProfile(db);
  const [name, setName] = useState('');
  return (
    <Screen title={locale === 'en' ? 'Where are you?' : 'وين إنت؟'}>
      {(cities.data as Array<{ id: string; name_en: string; name_ar: string; stage: string }> | undefined)?.map((c) => (
        <ListRow key={c.id} title={locale === 'en' ? c.name_en : c.name_ar} subtitle={c.stage === 'live' ? '' : 'waitlist'}
          onPress={async () => {
            if (c.stage !== 'live') return router.push({ pathname: '/waitlist', params: { city: c.name_en } });
            await complete.mutateAsync({ firstName: name || 'Guest', market, cityId: c.id });
            set({ cityId: c.id }); router.replace('/(tabs)');
          }} />
      ))}
    </Screen>
  );
}
