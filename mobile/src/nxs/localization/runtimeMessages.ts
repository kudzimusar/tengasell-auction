import type { NxsTranslator } from "./catalog";

const EXACT_MESSAGES: Record<string, Parameters<NxsTranslator>[0]> = {
  "Secure credential storage is unavailable on this device.":
    "session.secureStorageUnavailable",
  "Session recovery is temporarily unavailable.": "session.recoveryUnavailable",
  "Stored session could not be restored safely.": "session.storedSessionInvalid",
  "Your session has expired. Sign in again.": "session.expired",
  "Your session is no longer valid. Sign in again.": "session.invalid",
  "Session changed while authentication was completing.":
    "session.changedDuringAuth",
  "Session changed while credentials were being persisted.":
    "session.changedDuringPersistence",
  "No stored TrailBase session is available.": "session.noStoredSession",
  "Protected request attempted without an authenticated session.":
    "session.protectedWithoutSession",
  "Protected response was discarded because the session changed.":
    "session.responseDiscarded",
  "Canonical TrailBase authority is unreachable.": "common.canonicalUnreachable",
  "Canonical API is not configured. Set EXPO_PUBLIC_TENGASELL_API before running this build.":
    "common.canonicalNotConfigured",
  "Incorrect email/username or password.": "login.wrongCredentials",
  "The authenticated TrailBase session is no longer valid.":
    "trailbase.sessionInvalid",
  "The TrailBase refresh session is invalid or expired.":
    "trailbase.refreshInvalid",
  "This account requires MFA. MOB-01 does not implement MFA entry.":
    "trailbase.mfaRequired",
  "TrailBase login response was not an object.": "trailbase.loginMalformed",
  "TrailBase login response did not contain both auth and refresh tokens.":
    "trailbase.loginMalformed",
  "TrailBase refresh response did not contain an auth token.":
    "trailbase.refreshMalformed",
};

export function localizeKnownRuntimeMessage(
  message: string | null | undefined,
  t: NxsTranslator,
  fallbackKey: Parameters<NxsTranslator>[0],
): string {
  if (!message) return t(fallbackKey);

  const exact = EXACT_MESSAGES[message];
  if (exact) return t(exact);

  const malformed = message.match(
    /^Canonical TrailBase returned malformed JSON \(HTTP (\d+)\)\.$/,
  );
  if (malformed) return t("trailbase.malformedJson", { status: malformed[1] });

  const httpFailure = message.match(
    /^Canonical TrailBase request failed with HTTP (\d+)\.$/,
  );
  if (httpFailure) return t("trailbase.httpFailure", { status: httpFailure[1] });

  // Unknown server/domain messages are intentionally preserved verbatim.
  // NXS pseudolocalization must not mechanically mutate backend/product truth.
  return message;
}
