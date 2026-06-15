import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env, isSupabaseConfigured } from '../config/env';

export const SUPABASE_URL = env.supabaseUrl;
export const SUPABASE_ANON_KEY = env.supabaseAnonKey;
export { isSupabaseConfigured as isSupabaseReady };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
