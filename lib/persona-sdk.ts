/**
 * Thin wrapper around the Persona React Native SDK.
 *
 * The SDK is loaded via a runtime require() guarded by try/catch so the rest
 * of the app keeps building when the native module isn't installed yet
 * (typical during Phase 4 rollout — the JS screen lands first, the Persona
 * pods/AAR follow after a dev runs `npm install` + a native rebuild).
 *
 * Install (see also docs/PERSONA_SDK_SETUP.md if present):
 *   npm install react-native-persona
 *   cd ios && pod install && cd ..
 *   npx expo run:ios   # or expo prebuild for managed -> bare migration
 */

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
  console.log('[IDENTITY_VERIFICATION] persona-sdk: module resolved =', !!mod,
    'keys =', mod ? Object.keys(mod as object).join(',') : '(none)');
  return mod !== null;
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

const loadPersonaModule = (): { default?: unknown; Inquiry?: unknown } | null => {
  if (cachedModule !== undefined) {
    return (cachedModule as { default?: unknown; Inquiry?: unknown } | null);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-persona');
    cachedModule = mod ?? null;
    console.log('[IDENTITY_VERIFICATION] require("react-native-persona") OK',
      'type =', typeof mod,
      'keys =', mod ? Object.keys(mod).join(',') : '(none)');
    return cachedModule as { default?: unknown; Inquiry?: unknown } | null;
  } catch (e) {
    console.log('[IDENTITY_VERIFICATION] require("react-native-persona") FAILED');
    console.log('[IDENTITY_VERIFICATION]   name:', e instanceof Error ? e.name : typeof e);
    console.log('[IDENTITY_VERIFICATION]   message:', e instanceof Error ? e.message : String(e));
    console.log('[IDENTITY_VERIFICATION]   stack:', e instanceof Error ? e.stack : '(no stack)');
    cachedModule = null;
    return null;
  }
};
