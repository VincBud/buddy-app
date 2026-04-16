import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { runDevSeed } from '../lib/dev-seed';
import { loadDevSession } from '../lib/dev-session';
import { loadLanguage, useLanguage } from '../lib/i18n';

export default function RootLayout() {
  useLanguage();

  useEffect(() => {
    loadLanguage();
    loadDevSession();
    runDevSeed();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}