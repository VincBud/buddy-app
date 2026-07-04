/**
 * Shared image-source helpers: "Foto aufnehmen" vs. "Aus Galerie wählen".
 *
 * Screens keep their existing (per-screen) gallery flows — multi-select in
 * create, editing/aspect for avatars — and use these helpers only for the
 * source chooser and the camera capture. Compression/upload stays in
 * services/media.service.ts and is untouched.
 *
 * Photos only — no videos, no microphone (matches the app.json plugin config).
 */
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import i18n from './i18n';

export type ImageSource = 'camera' | 'library';

/**
 * Ask the user where the image should come from. Resolves null on cancel.
 * Uses a native Alert so no new UI components/dependencies are needed.
 */
export const chooseImageSource = (): Promise<ImageSource | null> =>
  new Promise((resolve) => {
    Alert.alert(
      i18n.t('media_picker.title'),
      undefined,
      [
        { text: i18n.t('media_picker.take_photo'), onPress: () => resolve('camera') },
        { text: i18n.t('media_picker.from_library'), onPress: () => resolve('library') },
        { text: i18n.t('media_picker.cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });

export type TakePhotoOutcome =
  | { status: 'ok'; uri: string }
  | { status: 'canceled' }
  | { status: 'permission_denied' };

/**
 * One-shot camera capture (images only, quality 0.8). Requests camera
 * permission; when denied it shows the explanatory alert itself and returns
 * permission_denied. Never throws.
 */
export const takePhotoWithCamera = async (options?: {
  allowsEditing?: boolean;
  aspect?: [number, number];
}): Promise<TakePhotoOutcome> => {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        i18n.t('media_picker.camera_denied_title'),
        i18n.t('media_picker.camera_denied_body'),
      );
      return { status: 'permission_denied' };
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: options?.allowsEditing ?? false,
      ...(options?.aspect ? { aspect: options.aspect } : {}),
    });

    if (result.canceled) return { status: 'canceled' };
    const uri = result.assets?.[0]?.uri;
    if (!uri) return { status: 'canceled' };
    return { status: 'ok', uri };
  } catch (e) {
    console.warn('[media-picker] takePhotoWithCamera failed:', e instanceof Error ? e.message : String(e));
    return { status: 'canceled' };
  }
};
