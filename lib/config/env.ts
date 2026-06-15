/**
 * Centralised environment configuration.
 *
 * All process.env reads live here so that:
 *  - There is a single place to audit what the app reads from the environment.
 *  - Missing values are handled gracefully (empty-string defaults, never throws).
 *  - No other file should access process.env directly.
 *
 * Never commit real credentials.
 * Copy .env.example → .env.local and fill in your project values.
 */

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
} as const;

/**
 * True when both Supabase env vars are present and look structurally valid.
 * Gate every Supabase call behind this flag during the local → backend transition.
 *
 * Usage in services:
 *   if (isSupabaseConfigured) { ...supabase query... } else { ...AsyncStorage... }
 */
export const isSupabaseConfigured =
  env.supabaseUrl.startsWith('https://') &&
  env.supabaseAnonKey.length > 20;
