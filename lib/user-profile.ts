import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './storage-keys';

export type UserProfile = {
  bio: string;
  profileImageUri: string | null;
};

const USER_PROFILE_STORAGE_KEY = STORAGE_KEYS.USER_PROFILE;
const LEGACY_PROFILE_IMAGE_STORAGE_KEY = STORAGE_KEYS.PROFILE_IMAGE_URI;

const DEFAULT_USER_PROFILE: UserProfile = {
  bio: '',
  profileImageUri: null,
};

export const loadUserProfile = async (): Promise<UserProfile> => {
  try {
    const rawProfile = await AsyncStorage.getItem(USER_PROFILE_STORAGE_KEY);
    const legacyProfileImageUri = await AsyncStorage.getItem(LEGACY_PROFILE_IMAGE_STORAGE_KEY);

    const parsed = rawProfile ? JSON.parse(rawProfile) : {};
    const bio = typeof parsed?.bio === 'string' ? parsed.bio : '';

    const profileImageUri =
      typeof parsed?.profileImageUri === 'string'
        ? parsed.profileImageUri
        : legacyProfileImageUri;

    return {
      bio,
      profileImageUri: profileImageUri || null,
    };
  } catch (error) {
    console.error('Error loading user profile:', error);
    return DEFAULT_USER_PROFILE;
  }
};

export const saveUserProfile = async (profile: UserProfile): Promise<void> => {
  const safeProfile: UserProfile = {
    bio: typeof profile.bio === 'string' ? profile.bio : '',
    profileImageUri: typeof profile.profileImageUri === 'string' ? profile.profileImageUri : null,
  };

  await AsyncStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(safeProfile));

  if (safeProfile.profileImageUri) {
    await AsyncStorage.setItem(LEGACY_PROFILE_IMAGE_STORAGE_KEY, safeProfile.profileImageUri);
  } else {
    await AsyncStorage.removeItem(LEGACY_PROFILE_IMAGE_STORAGE_KEY);
  }
};

export const updateUserProfile = async (
  updates: Partial<UserProfile>
): Promise<UserProfile> => {
  const current = await loadUserProfile();
  const next: UserProfile = {
    bio: updates.bio !== undefined ? updates.bio : current.bio,
    profileImageUri:
      updates.profileImageUri !== undefined
        ? updates.profileImageUri
        : current.profileImageUri,
  };

  await saveUserProfile(next);
  return next;
};
