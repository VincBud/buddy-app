import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';
import i18n, { useLanguage } from '../lib/i18n';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function ModalScreen() {
  useLanguage();
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">{i18n.t('modal.modal_title')}</ThemedText>
      <Link href="/" dismissTo style={styles.link}>
        <ThemedText type="link">{i18n.t('modal.modal_go_home')}</ThemedText>
      </Link>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
