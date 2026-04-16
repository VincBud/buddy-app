import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { colors } from '../lib/colors';
import i18n from '../lib/i18n';
import { Job } from '../lib/jobs';
import { layout, spacing } from '../lib/spacing';

const USER_LOCATION = {
  lat: 47.856,
  lng: 12.128,
};

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface RecommendationModalProps {
  visible: boolean;
  jobs: Job[];
  onDismiss: () => void;
  excludeJobId?: string;
  buddyRadius: number;
}

export default function RecommendationModal({
  visible,
  jobs,
  onDismiss,
  excludeJobId,
  buddyRadius,
}: RecommendationModalProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);

  const getRelevantJobs = (): Job[] => {
    return jobs
      .filter((job) => job.status === 'open' && job.id !== excludeJobId)
      .slice(0, 4)
      .sort((a, b) => {
        const distA = a.location
          ? getDistance(
              USER_LOCATION.lat,
              USER_LOCATION.lng,
              a.location.lat,
              a.location.lng
            )
          : 9999;
        const distB = b.location
          ? getDistance(
              USER_LOCATION.lat,
              USER_LOCATION.lng,
              b.location.lat,
              b.location.lng
            )
          : 9999;

        if (distA !== distB) return distA - distB;

        const priceA = parseFloat(a.price) || 0;
        const priceB = parseFloat(b.price) || 0;
        if (priceA !== priceB) return priceB - priceA;

        return Number(b.id) - Number(a.id);
      });
  };

  const relevantJobs = getRelevantJobs();

  const handleViewJob = (job: Job) => {
    router.push({
      pathname: '/job/[id]',
      params: { id: job.id },
    });
    onDismiss();
  };

  const handleDismiss = () => {
    setDismissed(true);
    setTimeout(onDismiss, 300);
  };

  const getJobDistance = (job: Job): string | null => {
    if (!job.location) return null;
    const dist = getDistance(
      USER_LOCATION.lat,
      USER_LOCATION.lng,
      job.location.lat,
      job.location.lng
    );
    return dist.toFixed(1);
  };

  const getTimeBadge = (job: Job) => {
    if (job.timeMode === 'sofort') return i18n.t('common.asap_badge');
    if (job.timeMode === 'flexibel') return i18n.t('common.flexible');
    if (job.timeMode === 'termin') return i18n.t('common.scheduled');
    return job.time || i18n.t('common.time_open');
  };

  if (relevantJobs.length === 0) {
    return null;
  }

  return (
    <Modal
      visible={visible && !dismissed}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {i18n.t('recommendations.title')}
            </Text>
            <Pressable
              style={styles.closeButton}
              onPress={handleDismiss}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.jobList}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {relevantJobs.map((job) => {
              const distance = getJobDistance(job);
              return (
                <View key={job.id} style={styles.jobCard}>
                  {job.media && job.media.length > 0 && (
                    <Image
                      source={{ uri: job.media[0] }}
                      style={styles.jobImage}
                    />
                  )}

                  <View style={styles.jobContent}>
                    <Text style={styles.jobProblem} numberOfLines={2}>
                      {job.problem}
                    </Text>

                    <View style={styles.jobMeta}>
                      <View style={styles.metaRow}>
                        <Text style={styles.price}>€ {job.price}</Text>
                        {distance && (
                          <Text style={styles.distance}>
                            {distance} {i18n.t('job.km')}
                          </Text>
                        )}
                      </View>

                      <Text style={styles.timeBadgeText}>
                        {getTimeBadge(job)}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    style={styles.viewButton}
                    onPress={() => handleViewJob(job)}
                  >
                    <Text style={styles.viewButtonText}>
                      {i18n.t('recommendations.view_job')}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <Pressable style={styles.dismissButton} onPress={handleDismiss}>
            <Text style={styles.dismissButtonText}>
              {i18n.t('recommendations.later')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: spacing.xxxl,
    borderTopRightRadius: spacing.xxxl,
    paddingTop: layout.screenPaddingX,
    paddingHorizontal: layout.cardPadding,
    paddingBottom: layout.screenPaddingX,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: layout.cardPadding,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSmall,
    backgroundColor: colors.lightPurple,
  },
  closeIcon: {
    fontSize: 20,
    color: colors.secondary,
    fontWeight: '600',
  },
  jobList: {
    marginBottom: spacing.lg,
    maxHeight: 380,
  },
  jobCard: {
    backgroundColor: colors.card,
    borderRadius: layout.borderRadiusSmall,
    marginBottom: spacing.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  jobImage: {
    width: '100%',
    height: 120,
    backgroundColor: colors.veryLightPurple,
  },
  jobContent: {
    padding: spacing.lg,
  },
  jobProblem: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  jobMeta: {
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  distance: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  timeBadgeText: {
    fontSize: 13,
    color: '#9B7A5E',
    fontWeight: '600',
  },
  viewButton: {
    backgroundColor: colors.secondary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: layout.borderRadiusSmall,
    margin: spacing.lg,
    marginTop: 0,
    alignItems: 'center',
  },
  viewButtonText: {
    color: colors.card,
    fontSize: 14,
    fontWeight: '700',
  },
  dismissButton: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: layout.borderRadiusSmall,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
});
