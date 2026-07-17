import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { Tabs, router, useRootNavigationState } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import { eventBus } from '../../lib/event-bus';
import i18n, { useLanguage } from '../../lib/i18n';
import { getUnreadNotificationCount } from '../../lib/notifications';
import { getNotifications } from '../../services/notifications.service';
import { getActiveUserId } from '../../lib/auth';
import { loadUserPreferences } from '../../lib/preferences';
import { fetchVerificationStatus } from '../../services/identity-verification.service';

export default function TabLayout() {
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  const rootNavigationState = useRootNavigationState();
  const checkedOnboardingRef = useRef(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const badgeScale = useRef(new Animated.Value(1)).current;
  const prevUnreadRef = useRef(0);

  useEffect(() => {
    if (!rootNavigationState?.key || checkedOnboardingRef.current) return;

    checkedOnboardingRef.current = true;
    let cancelled = false;

    const verifyOnboarding = async () => {
      try {
        // Belt-and-braces identity gate: if a user deep-links straight into
        // /(tabs) somehow, kick them back to /identity-verification unless
        // the server says they're approved. Backend RLS still blocks any
        // privileged action, but this prevents a confusing "broken app"
        // experience for an unverified user.
        const verification = await fetchVerificationStatus();
        if (
          !cancelled &&
          verification &&
          (verification.verificationStatus !== 'approved' || !verification.identityVerifiedAt)
        ) {
          router.replace('/identity-verification');
          return;
        }

        const preferences = await loadUserPreferences(getActiveUserId() || undefined);
        if (!cancelled && !preferences.onboardingCompleted) {
          router.replace({ pathname: '/preferences', params: { mode: 'onboarding' } });
        }
      } catch (error) {
        console.error('Error verifying onboarding state:', error);
      }
    };

    verifyOnboarding();

    return () => {
      cancelled = true;
    };
  }, [rootNavigationState?.key]);

  const loadUnreadCount = useCallback(async () => {
    try {
      // Supabase-merged load (not just the local cache): the core cross-user
      // notifications (new application → owner, accepted/declined → buddy) are
      // written server-side by the DB trigger, so a storage-only read would keep
      // the bell badge at 0 until the notification center is opened once.
      const notifications = await getNotifications();
      const unread = getUnreadNotificationCount(notifications);
      setUnreadCount((prev) => {
        if (unread > prev) {
          Animated.sequence([
            Animated.spring(badgeScale, { toValue: 1.45, useNativeDriver: true, speed: 40, bounciness: 12 }),
            Animated.spring(badgeScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }),
          ]).start();
        }
        prevUnreadRef.current = unread;
        return unread;
      });
    } catch {
      setUnreadCount(0);
    }
  }, [badgeScale]);

  // Instant updates via event bus; re-sync on focus for cold starts
  useEffect(() => {
    return eventBus.on('notifications:changed', loadUnreadCount);
  }, [loadUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      loadUnreadCount();
    }, [loadUnreadCount])
  );

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.grey,
          tabBarStyle: {
            backgroundColor: colors.background,
          },
        }}
        key={language}
      >
        <Tabs.Screen
          name="index"
          options={() => ({
            title: i18n.t('tabs.home_tab'),
            tabBarIcon: ({ color, size }: { color: string; size: number }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          })}
        />

        <Tabs.Screen
          name="create"
          options={() => ({
            title: i18n.t('tabs.create_tab'),
            tabBarIcon: ({ color, size }: { color: string; size: number }) => (
              <Ionicons name="add-circle" size={size} color={color} />
            ),
          })}
        />

        <Tabs.Screen
          name="feed"
          options={() => ({
            title: i18n.t('tabs.feed_tab'),
            tabBarIcon: ({ color, size }: { color: string; size: number }) => (
              <Ionicons name="list" size={size} color={color} />
            ),
          })}
        />

        <Tabs.Screen
          name="profile"
          options={() => ({
            title: i18n.t('tabs.profile_tab'),
            tabBarIcon: ({ color, size }: { color: string; size: number }) => (
              <Ionicons name="person" size={size} color={color} />
            ),
          })}
        />
      </Tabs>

      <Pressable
        onPress={() => router.push('/notifications')}
        style={[styles.bellButton, { top: insets.top + 10 }]}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
        {unreadCount > 0 && (
          <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.badgeText}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Text>
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bellButton: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    zIndex: 30,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.card,
    fontSize: 10,
    fontWeight: '700',
  },
});