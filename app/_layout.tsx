import { router, Stack, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { getActiveUserEmail, onAuthStateChange } from '../lib/auth';
import { loadCurrentUser } from '../lib/current-user';
import { loadLanguage, useLanguage } from '../lib/i18n';
import { loadUserPreferences } from '../lib/preferences';
import { ensureProfile, getProfile } from '../services/profiles.service';

export default function RootLayout() {
  useLanguage();
  const navState = useRootNavigationState();
  const pendingRouteRef = useRef<string | null>(null);
  const segments = useSegments();
  const segmentsRef = useRef(segments);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  // Navigate once navigator is ready
  useEffect(() => {
    if (!navState?.key || !pendingRouteRef.current) return;
    const route = pendingRouteRef.current;
    pendingRouteRef.current = null;
    router.replace(route as Parameters<typeof router.replace>[0]);
  }, [navState?.key]);

  useEffect(() => {
    loadLanguage();

    const navigate = (route: string) => {
      if (!navState?.key) {
        pendingRouteRef.current = route;
      } else {
        router.replace(route as Parameters<typeof router.replace>[0]);
      }
    };

    const unsubscribe = onAuthStateChange(async (userId, event) => {
      if (userId) {
        loadCurrentUser();
        ensureProfile({ id: userId, email: getActiveUserEmail() });

        // Load the profile once and use it for both the identity-verification
        // gate AND the onboarding check, so we don't hit the network twice.
        let profile: Awaited<ReturnType<typeof getProfile>> = null;
        try {
          profile = await getProfile(userId);
        } catch {
          // Network unavailable — fall through. The verification gate will
          // default to "approved" so the user is not locked out of the
          // offline-capable parts of the app; the next online auth event
          // will re-run the gate.
        }

        // ── Identity verification gate ────────────────────────────────────
        // Backend gates (RLS + RPC checks) are authoritative; this client
        // gate just keeps unverified users out of the main app surface so
        // they don't bounce off failed writes. Phase 1.5/2/3 work means an
        // unverified user simply cannot create jobs / apply / review /
        // complete server-side; the screen makes that explicit.
        const verificationStatus = profile?.verification_status ?? null;
        const isVerified =
          verificationStatus === 'approved' && !!profile?.identity_verified_at;
        // If we never got the profile at all, we don't have signal — defer
        // the gate to the next online refresh rather than block the user.
        const needsVerification = profile != null && !isVerified;

        if (needsVerification) {
          navigate('/identity-verification');
          return;
        }

        // ── Onboarding check (unchanged behaviour) ────────────────────────
        const needsOnboarding = await (async (): Promise<boolean> => {
          if (
            profile?.username &&
            Array.isArray(profile.skills) &&
            profile.skills.length >= 3 &&
            profile.radius_km != null
          ) {
            return false;
          }
          const prefs = await loadUserPreferences(userId);
          return !prefs.onboardingCompleted;
        })();

        if (needsOnboarding) {
          router.replace({ pathname: '/preferences', params: { mode: 'onboarding' } });
        } else {
          navigate('/(tabs)');
        }
      } else {
        // On INITIAL_SESSION with no session, don't redirect if the callback
        // screen is actively handling the magic link exchange.
        const inCallbackRoute =
          segmentsRef.current[0] === 'auth' &&
          segmentsRef.current[1] === 'callback';
        if (event === 'INITIAL_SESSION' && inCallbackRoute) return;
        navigate('/welcome');
      }
    });

    return unsubscribe;
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
