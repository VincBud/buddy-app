/**
 * Auth module — Supabase Magic Link / PKCE auth.
 *
 * Wraps Supabase auth and exposes a sync userId accessor populated
 * at startup, so screens can read the current user ID without await.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { supabase } from './supabase/client';

/**
 * Apple returns the user's full name ONLY on the very first authorization.
 * We stash it here (best-effort) so a later onboarding/profile step can seed a
 * display name. Reading/clearing it is the consumer's job; it never blocks
 * sign-in or ensureProfile.
 */
export const APPLE_PENDING_NAME_KEY = 'buddy_apple_pending_name';

// Builds the redirect URL that Supabase puts in the Magic Link email.
//
// Expo Go (physical device):  exp://192.168.x.x:<port>/--/auth/callback
// Expo Go (simulator):        exp://127.0.0.1:<port>/--/auth/callback
// Standalone build:           buddy://auth/callback
// Web (browser):              <origin>/auth/callback
//
// Supabase dashboard → Authentication → URL Configuration → Redirect URLs
// must include the pattern that matches what this function returns.
// For Expo Go add the wildcard:  exp://*/*--/auth/callback
const getAuthRedirectUrl = (): string => {
  if (Platform.OS === 'web') {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    return `${origin}/auth/callback`;
  }
  // Native — Linking.createURL resolves to exp:// in Expo Go, buddy:// in standalone
  return Linking.createURL('/auth/callback');
};

// Module-level cache — sync access, populated by loadAuthSession()
let _userId: string = '';
let _userEmail: string | undefined;

/** Populate the cache from the persisted Supabase session. Call once at startup. */
export const loadAuthSession = async (): Promise<void> => {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    _userId = data.session.user.id;
    _userEmail = data.session.user.email ?? undefined;
  }
};

/** Sync — returns cached userId (empty string when not signed in). */
export const getActiveUserId = (): string => _userId;

/** Sync — returns cached user email. */
export const getActiveUserEmail = (): string | undefined => _userEmail;

/**
 * Sends a one-time password (OTP) to the given email.
 * User then enters the 6-digit code to complete sign-in.
 *
 * Flow: PKCE on all platforms. The email type is determined by emailRedirectTo:
 *   - Native (no emailRedirectTo): Supabase sends a 6-digit code email.
 *     The email template MUST include {{ .Token }} for the code to appear.
 *   - Web (with emailRedirectTo): Supabase sends a magic-link email.
 *     The template should include {{ .ConfirmationURL }}.
 *
 * Supabase dashboard → Authentication → Email Templates → "Magic Link":
 *   Keep: {{ .ConfirmationURL }} — used by the magic-link / web path.
 *   Add:  Your login code is: <strong>{{ .Token }}</strong> — used by native.
 *
 * Verification: supabase.auth.verifyOtp({ email, token, type: 'email' })
 * GoTrue's /verify endpoint does NOT require the PKCE code_verifier for the
 * manual token-entry path — code_verifier is only used when processing magic-link
 * redirect URLs (the PKCE code exchange in the auth/callback route).
 */
// TODO(rate-limit): enforce per-email OTP send rate limit (e.g. 3/hour) before calling Supabase Auth.
export const sendOtp = async (email: string): Promise<{ error?: string }> => {
  const isNative = Platform.OS !== 'web';

  if (isNative) {
    // No emailRedirectTo → Supabase sends 6-digit code email (not a magic link).
    // Uses the main PKCE client — avoids 500s from projects that enforce PKCE on /otp.
    if (__DEV__) console.log('[Auth] sendOtp | platform:', Platform.OS, '| env:', Constants.executionEnvironment, '| flow: PKCE OTP code (no redirect)');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      console.warn('[Auth] sendOtp native failed | message:', error.message, '| status:', (error as { status?: number }).status ?? 'n/a');
      return { error: 'Code konnte nicht gesendet werden.' };
    }
    return {};
  }

  // Web: magic-link via PKCE redirect
  const redirectUrl = getAuthRedirectUrl();
  if (__DEV__) console.log('[Auth] sendOtp | platform:', Platform.OS, '| env:', Constants.executionEnvironment, `| flow: PKCE magic-link → ${redirectUrl}`);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: redirectUrl },
  });
  if (error) {
    console.warn('[Auth] sendOtp web failed | message:', error.message, '| status:', (error as { status?: number }).status ?? 'n/a');
    return { error: 'Code konnte nicht gesendet werden.' };
  }
  return {};
};

/**
 * Verifies the OTP code entered by the user.
 * On success, updates the module cache with the new session.
 */
// TODO(rate-limit): enforce per-email OTP verify rate limit (e.g. 5 attempts) to block brute-force.
export const verifyOtp = async (
  email: string,
  token: string
): Promise<{ error?: string }> => {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) return { error: error.message };
  if (data.session?.user) {
    _userId = data.session.user.id;
    _userEmail = data.session.user.email ?? undefined;
  }
  return {};
};

/**
 * Native Sign in with Apple (iOS only). Mirrors the OTP helpers: never throws,
 * returns a typed outcome, and updates the module session cache on success.
 * Routing (verification/onboarding gates) is handled by the existing
 * onAuthStateChange listener — this function does not navigate.
 *
 * Nonce flow: a random rawNonce is generated; its SHA-256 hash is sent to Apple
 * (embedded in the returned identity token), and the rawNonce is handed to
 * Supabase so it can verify the token was minted for this request.
 */
export const signInWithApple = async (): Promise<{ error?: string; canceled?: boolean }> => {
  try {
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      console.warn('[Auth] signInWithApple: missing identityToken');
      return { error: 'apple_signin_failed' };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) {
      console.warn('[Auth] signInWithApple: signInWithIdToken failed | message:', error.message);
      return { error: 'apple_signin_failed' };
    }

    if (data.session?.user) {
      _userId = data.session.user.id;
      _userEmail = data.session.user.email ?? undefined;
    }

    // Apple only sends the name on first authorization — persist it best-effort
    // for later profile seeding. Non-fatal; never touches ensureProfile here.
    const displayName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (displayName) {
      try { await AsyncStorage.setItem(APPLE_PENDING_NAME_KEY, displayName); } catch { /* non-fatal */ }
    }

    return {};
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
      return { canceled: true };
    }
    console.warn('[Auth] signInWithApple failed:', e instanceof Error ? e.message : String(e));
    return { error: 'apple_signin_failed' };
  }
};

/** Signs the user out and clears the local cache. */
export const signOut = async (): Promise<void> => {
  await supabase.auth.signOut();
  _userId = '';
  _userEmail = undefined;
};

/**
 * Subscribes to auth state changes.
 * Returns an unsubscribe function.
 */
export const onAuthStateChange = (
  callback: (userId: string | null, event: string) => void
): (() => void) => {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    _userId = session?.user?.id ?? '';
    _userEmail = session?.user?.email ?? undefined;
    callback(session?.user?.id ?? null, event);
  });
  return () => data.subscription.unsubscribe();
};
