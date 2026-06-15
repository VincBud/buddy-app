/**
 * Thin wrapper around the Persona React Native SDK.
 *
 * IMPORTANT — Expo Go / out-of-date dev build safety:
 *
 * The Persona SDK's CJS entry executes
 *     const eventEmitter = new NativeEventEmitter(PersonaInquiry2);
 * at module load. When `PersonaInquiry2` is not registered as a native
 * module (Expo Go, or a dev build created before `react-native-persona`
 * was added), the NativeEventEmitter constructor throws an Invariant
 * Violation BEFORE `require()` returns — and Metro keeps re-throwing on
 * every subsequent require() of the same id, even from inside a try/catch.
 *
 * The only correct guard is to probe `NativeModules.PersonaInquiry2` BEFORE
 * `require('react-native-persona')` is ever evaluated. If the native
 * module isn't linked we return null immediately and never touch the
 * package. Once a real dev build is created (pods installed +
 * `expo run:ios` / `run:android`), the probe succeeds and the SDK loads
 * normally.
 *
 * Install:
 *   npm install react-native-persona
 *   npx expo prebuild --clean       # if you don't already have ios/android
 *   cd ios && pod install && cd ..
 *   npx expo run:ios                # full native rebuild
 *   # JS-only reload / Expo Go cannot pick up native modules.
 */

import { NativeModules, Platform } from 'react-native';

const PERSONA_NATIVE_MODULE_NAME = 'PersonaInquiry2';

export type PersonaLaunchInput = {
  inquiryId: string;
  sessionToken?: string | null;
  environmentId?: string | null;   // optional Persona env id, e.g. 'env_…'
};

export type PersonaLaunchResult =
  | { outcome: 'completed'; inquiryId: string; status?: string | null }
  | { outcome: 'canceled'; inquiryId?: string | null }
  | { outcome: 'error'; message: string }
  | { outcome: 'sdk_unavailable'; message: string };

/**
 * Returns true if `react-native-persona` is actually installed and linkable.
 * The screen uses this to render an explanatory state when the SDK isn't
 * available yet, instead of crashing.
 */
export const isPersonaSdkAvailable = (): boolean => {
  const mod = loadPersonaModule();
  const available = mod !== null;
  console.log('[IDENTITY_VERIFICATION] isPersonaSdkAvailable =', available, {
    platform: Platform.OS,
    keys: mod ? Object.keys(mod as object).join(',') : '(none)',
  });
  return available;
};

/**
 * Launch the Persona inquiry flow. Resolves with the outcome — never throws.
 */
export const launchPersonaInquiry = async (
  input: PersonaLaunchInput
): Promise<PersonaLaunchResult> => {
  console.log('[IDENTITY_VERIFICATION] launchPersonaInquiry called with',
    JSON.stringify({ inquiryId: input.inquiryId, hasSessionToken: !!input.sessionToken }));
  const mod = loadPersonaModule();
  if (!mod) {
    console.log('[IDENTITY_VERIFICATION] persona-sdk: module not available → sdk_unavailable');
    return {
      outcome: 'sdk_unavailable',
      message: 'react-native-persona is not installed in this build.',
    };
  }

  try {
    return await new Promise<PersonaLaunchResult>((resolve) => {
      // SDK API per react-native-persona v2.x. We type the dynamic import as
      // `any` deliberately — the module isn't a compile-time dependency, and
      // its real shape is enforced at runtime by the try/catch around start().
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Inquiry: any = (mod as any).default ?? (mod as any).Inquiry ?? mod;
      console.log('[IDENTITY_VERIFICATION] persona-sdk: Inquiry shape =',
        typeof Inquiry, 'has fromInquiry =', typeof Inquiry?.fromInquiry);

      // The react-native-persona SDK expects fromInquiry to be called with
      // the inquiry id as a positional string argument, not an object.
      // Passing an object trips the SDK's internal makeInquiryId, which
      // calls startsWith on the value and throws
      //   TypeError: candidate.startsWith is not a function
      // before the native UI is shown. Session token is optional and is
      // only chained when present.
      console.log('[IDENTITY_VERIFICATION] persona-sdk: fromInquiry argument',
        { type: typeof input.inquiryId, value: input.inquiryId });

      let builder = Inquiry.fromInquiry(input.inquiryId);
      if (input.sessionToken) {
        builder = builder.sessionToken(input.sessionToken);
      }
      console.log('[IDENTITY_VERIFICATION] persona-sdk: builder created, wiring callbacks…',
        { hasSessionToken: !!input.sessionToken });

      const built = builder
        .onComplete((inquiryId: string, status: string | null) => {
          console.log('[IDENTITY_VERIFICATION] persona-sdk onComplete', { inquiryId, status });
          resolve({ outcome: 'completed', inquiryId, status: status ?? null });
        })
        .onCanceled((inquiryId: string | null) => {
          console.log('[IDENTITY_VERIFICATION] persona-sdk onCanceled', { inquiryId });
          resolve({ outcome: 'canceled', inquiryId: inquiryId ?? null });
        })
        .onError((err: { message?: string } | string) => {
          console.log('[IDENTITY_VERIFICATION] persona-sdk onError', err);
          resolve({
            outcome: 'error',
            message: typeof err === 'string' ? err : err?.message ?? 'persona_sdk_error',
          });
        })
        .build();

      console.log('[IDENTITY_VERIFICATION] persona-sdk: calling built.start()');
      built.start();
    });
  } catch (e) {
    console.log('[IDENTITY_VERIFICATION] persona-sdk: caught exception in launch');
    console.log('[IDENTITY_VERIFICATION]   name:', e instanceof Error ? e.name : typeof e);
    console.log('[IDENTITY_VERIFICATION]   message:', e instanceof Error ? e.message : String(e));
    console.log('[IDENTITY_VERIFICATION]   stack:', e instanceof Error ? e.stack : '(no stack)');
    return {
      outcome: 'error',
      message: e instanceof Error ? e.message : 'persona_sdk_launch_failed',
    };
  }
};

// ── Internals ────────────────────────────────────────────────────────────────

// Cached require result so we don't try to resolve the module on every call.
let cachedModule: unknown | null | undefined;

/**
 * True iff the `PersonaInquiry2` native module is registered in this
 * runtime. We probe NativeModules directly so we can decide whether
 * touching `require('react-native-persona')` is safe — the package's
 * top-level code throws on Expo Go / unrebuilt dev builds.
 */
const isPersonaNativeModuleLinked = (): boolean => {
  try {
    const mod = (NativeModules as Record<string, unknown>)[PERSONA_NATIVE_MODULE_NAME];
    return mod != null;
  } catch {
    return false;
  }
};

const loadPersonaModule = (): { default?: unknown; Inquiry?: unknown } | null => {
  if (cachedModule !== undefined) {
    return (cachedModule as { default?: unknown; Inquiry?: unknown } | null);
  }

  const nativeLinked = isPersonaNativeModuleLinked();
  const personaNativeKeys = (() => {
    try {
      return Object.keys(NativeModules ?? {}).filter((k) =>
        k.toLowerCase().includes('persona'),
      );
    } catch {
      return [] as string[];
    }
  })();
  const devFlag = typeof __DEV__ !== 'undefined' ? __DEV__ : null;

  if (!nativeLinked) {
    // Critical short-circuit: do NOT call require('react-native-persona').
    // Its CJS entry constructs `new NativeEventEmitter(PersonaInquiry2)` at
    // module load — which throws an uncatchable Invariant Violation when
    // PersonaInquiry2 is undefined.
    console.log('[IDENTITY_VERIFICATION] persona-sdk: native module NOT linked', {
      platform: Platform.OS,
      dev: devFlag,
      expected_native_module: PERSONA_NATIVE_MODULE_NAME,
      persona_native_module_keys: personaNativeKeys,
      hint:
        'Likely cause: running inside Expo Go OR a dev build created before ' +
        '`react-native-persona` was added. Rebuild the dev client (see header comment).',
    });
    cachedModule = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-persona');
    cachedModule = mod ?? null;
    console.log('[IDENTITY_VERIFICATION] persona-sdk: require OK', {
      platform: Platform.OS,
      dev: devFlag,
      type: typeof mod,
      keys: mod ? Object.keys(mod).join(',') : '(none)',
    });
    return cachedModule as { default?: unknown; Inquiry?: unknown } | null;
  } catch (e) {
    // Defensive — should be unreachable now that we probe NativeModules first.
    console.log('[IDENTITY_VERIFICATION] persona-sdk: require FAILED unexpectedly', {
      platform: Platform.OS,
      dev: devFlag,
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : '(no stack)',
    });
    cachedModule = null;
    return null;
  }
};
