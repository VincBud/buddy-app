/**
 * Buddy Level System
 * Calculates progression based on Buddy Score
 */

export type BuddyStatus = 'new' | 'active' | 'trusted' | 'elite';

interface LevelInfo {
  level: number;
  status: BuddyStatus;
  currentLevelThreshold: number;
  nextLevelThreshold: number | null;
  progressPercentage: number;
}

// Level thresholds
const LEVEL_THRESHOLDS = [0, 50, 120, 200, 350, 550, 800, 1100, 1500, 2000];

/**
 * Get status based on level
 * Level 1-2: "New Buddy"
 * Level 3-5: "Active Buddy"
 * Level 6-8: "Trusted Buddy"
 * Level 9-10: "Elite Buddy"
 */
export const getStatusFromLevel = (level: number): BuddyStatus => {
  if (level <= 2) return 'new';
  if (level <= 5) return 'active';
  if (level <= 8) return 'trusted';
  return 'elite';
};

/**
 * Calculate level info from score
 */
export const getLevelInfo = (score: number): LevelInfo => {
  let level = 1;
  let currentLevelThreshold = 0;
  let nextLevelThreshold: number | null = null;

  // Find current level
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (score >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      currentLevelThreshold = LEVEL_THRESHOLDS[i];
      nextLevelThreshold = LEVEL_THRESHOLDS[i + 1] || null;
    } else {
      break;
    }
  }

  // Calculate progress to next level
  let progressPercentage = 0;
  if (nextLevelThreshold !== null) {
    const scoreInCurrentLevel = score - currentLevelThreshold;
    const scoreNeededForLevel = nextLevelThreshold - currentLevelThreshold;
    progressPercentage = Math.min(100, (scoreInCurrentLevel / scoreNeededForLevel) * 100);
  } else {
    // Max level reached
    progressPercentage = 100;
  }

  const status = getStatusFromLevel(level);

  return {
    level,
    status,
    currentLevelThreshold,
    nextLevelThreshold,
    progressPercentage,
  };
};

/**
 * Get score needed for next level
 */
export const getScoreForNextLevel = (score: number): number | null => {
  const levelInfo = getLevelInfo(score);
  if (levelInfo.nextLevelThreshold === null) {
    return null; // Already at max level
  }
  return levelInfo.nextLevelThreshold - score;
};

/**
 * Get all level thresholds
 */
export const getLevelThresholds = (): number[] => {
  return [...LEVEL_THRESHOLDS];
};
