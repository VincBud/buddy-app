import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../lib/colors';
import { supabase } from '../../lib/supabase/client';

const parseHash = (url: string): Record<string, string> => {
  const hash = url.split('#')[1] ?? '';
  return hash ? Object.fromEntries(new URLSearchParams(hash)) : {};
};

export default function AuthCallbackScreen() {
  // Expo Router parses query params from the deep link URL before mounting this
  // screen — useLocalSearchParams is the reliable way to get ?code=
  const params = useLocalSearchParams<{ code?: string }>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!handledRef.current) {
        handledRef.current = true;
        setErrorMessage('Login fehlgeschlagen. Bitte erneut versuchen.');
        setTimeout(() => router.replace('/auth'), 1500);
      }
    }, 8000);

    const resolve = async (code?: string, accessToken?: string, refreshToken?: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      clearTimeout(timeoutId);

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { router.replace('/auth'); return; }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) { router.replace('/auth'); return; }
        } else {
          router.replace('/auth');
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace('/(tabs)/feed');
        } else {
          router.replace('/auth');
        }
      } catch (err) {
        console.error('[AuthCallback] session exchange failed:', err instanceof Error ? err.message : 'unknown');
        router.replace('/auth');
      }
    };

    // Primary: Expo Router already parsed ?code= from the deep link URL
    if (params.code) {
      resolve(params.code);
      return () => clearTimeout(timeoutId);
    }

    // Fallback A: raw URL from Linking (cold start — hash params / implicit flow)
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const hash = parseHash(url);
      resolve(undefined, hash.access_token, hash.refresh_token);
    });

    // Fallback B: warm start URL event (in case Expo Router passes it through)
    const subscription = Linking.addEventListener('url', (event) => {
      const hash = parseHash(event.url);
      const qCode = event.url.split('?')[1]?.split('#')[0];
      const qParams = qCode ? Object.fromEntries(new URLSearchParams(qCode)) : {};
      resolve(qParams.code, hash.access_token, hash.refresh_token);
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.remove();
    };
  }, [params.code]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.text}>
        {errorMessage ?? 'Anmelden…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.background,
  },
  text: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
