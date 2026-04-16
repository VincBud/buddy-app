import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { Tabs, router, useRootNavigationState } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/colors';
import i18n, { useLanguage } from '../../lib/i18n';
import {
    getUnreadNotificationCount,
    loadNotificationsFromStorage,
} from '../../lib/notifications';
import { loadUserPreferences } from '../../lib/preferences';

export default function TabLayout() {
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  const rootNavigationState = useRootNavigationState();
  const checkedOnboardingRef = useRef(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!rootNavigationState?.key || checkedOnboardingRef.current) return;

    checkedOnboardingRef.current = true;
    let cancelled = false;

    const verifyOnboarding = async () => {
      try {
        const preferences = await loadUserPreferences();
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
      const notifications = await loadNotificationsFromStorage();
      const unread = getUnreadNotificationCount(notifications);
      setUnreadCount(unread);
    } catch (error) {
      console.error('Error loading unread count:', error);
      setUnreadCount(0);
    }
  }, []);

  // Load on tab focus
  useFocusEffect(
    useCallback(() => {
      loadUnreadCount();
    }, [loadUnreadCount])
  );

  // Poll for updates every 500ms while tab is focused
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => {
        loadUnreadCount();
      }, 500);
      return () => clearInterval(interval);
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
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Text>
          </View>
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