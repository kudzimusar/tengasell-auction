export const englishStrings = {
  "nav.signIn": "Sign in",
  "nav.account": "Account",

  "common.inProgress": "{action} in progress",
  "common.canonicalUnreachable": "The canonical TrailBase authority cannot be reached.",
  "common.canonicalNotConfigured":
    "Canonical API is not configured for this build.",
  "common.genericUnavailable": "The requested service is temporarily unavailable.",
  "common.errorWithMessage": "Error: {message}",

  "home.openAccount": "Open account",
  "home.signInA11y": "Sign in to {brand}",
  "home.authorityCheckingA11y": "Checking canonical auction authority",
  "home.authorityConnectedA11y": "Canonical auction authority connected",
  "home.authorityUnavailableA11y": "Canonical auction authority unavailable",
  "home.authorityChecking": "● Checking canonical authority",
  "home.authorityConnected": "● Canonical authority connected",
  "home.authorityUnavailable": "⚠ Canonical authority unavailable",
  "home.sessionInvalidFallback": "Your saved session is no longer valid. Sign in again.",
  "home.sessionRecoveryUnavailable":
    "Session recovery is unavailable while the authority cannot be reached.",
  "home.retrySession": "Retry session",
  "home.retryAuctionRequest": "Retry auction request",
  "home.loadingAuctionsA11y": "Loading auctions",
  "home.loadingAuctions": "Loading live auction data…",
  "home.liveUnavailableTitle": "Live auctions are temporarily unavailable",
  "home.noDemoFallback":
    "{brand} has not substituted demo or cached commercial authority.",
  "home.retryCanonical": "Retry canonical authority",
  "home.featured": "Featured",
  "home.showFeaturedAuctions": "Show featured auctions",
  "home.showCategoryAuctions": "Show {category} auctions",
  "home.refreshingAuctions": "Refreshing auctions…",
  "home.noLiveAuctions": "No live auctions here",
  "home.tryAnotherCategory": "Try another category or refresh the live authority.",
  "home.refreshAuctions": "Refresh auctions",
  "home.updatingTime": "Updating time…",
  "home.auctionA11y":
    "{title}. {price}. {bidCount} bids. {remaining} remaining.",
  "home.auctionMeta": "{price} · {bidCount} bids · @{seller}",
  "home.endingSoon": "Ending soon · {remaining}",
  "home.timeRemaining": "Time remaining · {remaining}",

  "login.restoringSession": "Restoring your secure session…",
  "login.recoveryUnavailableTitle": "Session recovery unavailable",
  "login.recoveryUnavailableFallback":
    "The canonical TrailBase authority cannot be reached.",
  "login.retryRecovery": "Retry session recovery",
  "login.clearSavedSession": "Clear saved session",
  "login.clearSavedSessionHint":
    "Removes the locally stored TrailBase session from this device.",
  "login.title": "Sign in to {brand}",
  "login.intro":
    "Credentials are sent only to the canonical TrailBase authentication authority.",
  "login.enterCredentials": "Enter your email or username and password.",
  "login.emailOrUsername": "Email or username",
  "login.password": "Password",
  "login.showPassword": "Show password",
  "login.hidePassword": "Hide password",
  "login.passwordVisibilityHint":
    "Changes whether the password characters are visible on screen.",
  "login.signIn": "Sign in",
  "login.mfaRequired":
    "This account requires MFA. MFA entry is outside MOB-01; use an account without MFA for this verification unit.",
  "login.signInFailed": "Sign in failed.",
  "login.wrongCredentials": "Incorrect email/username or password.",

  "account.restoringSession": "Restoring your secure session…",
  "account.unavailableTitle": "Account temporarily unavailable",
  "account.unavailableFallback":
    "The canonical TrailBase authority cannot be reached.",
  "account.retrySession": "Retry session",
  "account.signOutDevice": "Sign out on this device",
  "account.signOutDeviceHint":
    "Clears this device session and returns to the public home screen.",
  "account.returningToSignIn": "Returning to sign in…",
  "account.title": "Your account",
  "account.authenticatedStatus": "✓ Authenticated through canonical TrailBase",
  "account.loadingProfile": "Loading authenticated profile…",
  "account.profileRequestFailed": "Authenticated profile request failed.",
  "account.retryProfile": "Retry profile request",
  "account.authenticatedUser": "Authenticated user",
  "account.userId": "TrailBase user ID",
  "account.profileIncomplete": "ℹ Profile details are incomplete.",
  "account.profileIncompleteDetail":
    "The authenticated session remains valid, but TrailBase did not return a profile record.",
  "account.signOut": "Sign out",
  "account.signOutHint":
    "Ends the local session and requests canonical TrailBase logout.",

  "session.secureStorageUnavailable":
    "Secure credential storage is unavailable on this device.",
  "session.recoveryUnavailable": "Session recovery is temporarily unavailable.",
  "session.storedSessionInvalid": "Stored session could not be restored safely.",
  "session.expired": "Your session has expired. Sign in again.",
  "session.invalid": "Your session is no longer valid. Sign in again.",
  "session.changedDuringAuth": "Session changed while authentication was completing.",
  "session.changedDuringPersistence":
    "Session changed while credentials were being persisted.",
  "session.noStoredSession": "No stored TrailBase session is available.",
  "session.protectedWithoutSession":
    "Protected request attempted without an authenticated session.",
  "session.responseDiscarded":
    "Protected response was discarded because the session changed.",

  "trailbase.sessionInvalid":
    "The authenticated TrailBase session is no longer valid.",
  "trailbase.refreshInvalid": "The TrailBase refresh session is invalid or expired.",
  "trailbase.mfaRequired": "This account requires MFA. MOB-01 does not implement MFA entry.",
  "trailbase.loginMalformed": "TrailBase login response was not usable.",
  "trailbase.refreshMalformed": "TrailBase refresh response was not usable.",
  "trailbase.malformedJson":
    "Canonical TrailBase returned malformed JSON (HTTP {status}).",
  "trailbase.httpFailure":
    "Canonical TrailBase request failed with HTTP {status}.",
} as const;

export type NxsStringKey = keyof typeof englishStrings;
export type NxsLocaleMode = "en" | "en-XA" | "ar-XB";
export type NxsStringValues = Record<string, string | number>;
export type NxsTranslator = (
  key: NxsStringKey,
  values?: NxsStringValues,
) => string;

const ACCENTS: Record<string, string> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "đ",
  e: "ë",
  f: "ƒ",
  g: "ğ",
  h: "ħ",
  i: "ï",
  j: "ĵ",
  k: "ķ",
  l: "ľ",
  m: "ɱ",
  n: "ñ",
  o: "ô",
  p: "þ",
  q: "ɋ",
  r: "ř",
  s: "š",
  t: "ŧ",
  u: "ü",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ÿ",
  z: "ž",
};

function accentCharacter(character: string): string {
  const lower = character.toLowerCase();
  const mapped = ACCENTS[lower];
  if (!mapped) return character;
  return character === lower ? mapped : mapped.toUpperCase();
}

function transformLiteralSegment(segment: string, rtl: boolean): string {
  if (!segment.trim()) return segment;

  const accented = [...segment].map(accentCharacter).join("");
  const expanded = accented.replace(
    /\b([\p{L}]{4,})\b/gu,
    (word) => `${word}~`,
  );

  return rtl
    ? `\u2067⟦ ${expanded} ·· ⟧\u2069`
    : `⟦ ${expanded} ·· ⟧`;
}

function pseudolocalizeTemplate(
  template: string,
  mode: Exclude<NxsLocaleMode, "en">,
): string {
  return template
    .split(/(\{[A-Za-z0-9_]+\})/g)
    .map((part) =>
      /^\{[A-Za-z0-9_]+\}$/.test(part)
        ? part
        : transformLiteralSegment(part, mode === "ar-XB"),
    )
    .join("");
}

function interpolate(template: string, values: NxsStringValues): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

export function resolveNxsLocaleMode(value: string | undefined): NxsLocaleMode {
  if (value === "en-XA" || value === "ar-XB") return value;
  return "en";
}

export function translateNxs(
  key: NxsStringKey,
  mode: NxsLocaleMode,
  values: NxsStringValues = {},
): string {
  const template = englishStrings[key];
  const localized =
    mode === "en" ? template : pseudolocalizeTemplate(template, mode);
  return interpolate(localized, values);
}
