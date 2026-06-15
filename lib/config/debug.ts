/**
 * Centralised debug-logging flag.
 *
 * Production builds (release) and normal dev sessions stay quiet. Verbose
 * service/UI traces only appear when `EXPO_PUBLIC_DEBUG_LOGS=1` is set in
 * `.env.local` AND the build is a dev build (`__DEV__`). All warnings and
 * errors still flow through `console.warn` / `console.error` directly — only
 * informational `console.log` traces should be routed through `debugLog`.
 */

const flag = process.env.EXPO_PUBLIC_DEBUG_LOGS;

export const DEBUG_LOGS: boolean =
  typeof __DEV__ !== 'undefined' && __DEV__ === true &&
  (flag === '1' || flag === 'true');

export const debugLog = (...args: unknown[]): void => {
  if (DEBUG_LOGS) console.log(...args);
};
