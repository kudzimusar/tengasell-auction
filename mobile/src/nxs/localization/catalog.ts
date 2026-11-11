export const englishStrings = {
  "nav.signIn": "Sign in",
  "nav.account": "Account",

  "common.inProgress": "{action} in progress",
  "common.canonicalUnreachable": "Can’t connect to the marketplace. Check your connection and try again.",
  "common.canonicalNotConfigured":
    "The marketplace connection is not ready on this device. Contact support.",
  "common.genericUnavailable": "The requested service is temporarily unavailable.",
  "common.errorWithMessage": "Error: {message}",

  "home.openAccount": "Open account",
  "home.signInA11y": "Sign in to {brand}",
  "home.authorityCheckingA11y": "Checking the live marketplace connection",
  "home.authorityConnectedA11y": "Connected to live auctions",
  "home.authorityUnavailableA11y": "Live marketplace connection unavailable",
  "home.authorityChecking": "● Connecting to live auctions",
  "home.authorityConnected": "● Live auctions connected",
  "home.authorityUnavailable": "⚠ Live auctions unavailable",
  "home.sessionInvalidFallback": "Your saved session is no longer valid. Sign in again.",
  "home.sessionRecoveryUnavailable":
    "We can’t restore your sign-in while the marketplace connection is unavailable.",
  "home.retrySession": "Retry session",
  "home.retryAuctionRequest": "Retry auction request",
  "home.loadingAuctionsA11y": "Loading auctions",
  "home.loadingAuctions": "Loading live auction data…",
  "home.liveUnavailableTitle": "Live auctions are temporarily unavailable",
  "home.noDemoFallback":
    "Only live auction information is shown. Try again when the connection returns.",
  "home.retryCanonical": "Try connecting again",
  "home.featured": "Featured",
  "home.showFeaturedAuctions": "Show featured auctions",
  "home.showCategoryAuctions": "Show {category} auctions",
  "home.refreshingAuctions": "Refreshing auctions…",
  "home.noLiveAuctions": "No live auctions here",
  "home.tryAnotherCategory": "Try another category or refresh the auctions.",
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
    "Can’t connect to the marketplace. Check your connection and try again.",
  "login.retryRecovery": "Try restoring sign-in again",
  "login.clearSavedSession": "Sign out on this device",
  "login.clearSavedSessionHint":
    "Attempts to remove saved sign-in details and end the session securely.",
  "login.title": "Sign in to {brand}",
  "login.intro":
    "Enter your marketplace account details to sign in securely.",
  "login.enterCredentials": "Enter your email or username and password.",
  "login.emailOrUsername": "Email or username",
  "login.password": "Password",
  "login.showPassword": "Show password",
  "login.hidePassword": "Hide password",
  "login.passwordVisibilityHint":
    "Changes whether the password characters are visible on screen.",
  "login.signIn": "Sign in",
  "login.mfaRequired":
    "This account requires an extra verification step that is not available here yet.",
  "login.signInFailed": "Sign in failed.",
  "login.wrongCredentials": "Incorrect email/username or password.",

  "account.restoringSession": "Restoring your secure session…",
  "account.unavailableTitle": "Account temporarily unavailable",
  "account.unavailableFallback":
    "We couldn't connect to TengaSell. Check your connection and try again.",
  "account.retrySession": "Retry session",
  "account.signOutDevice": "Sign out on this device",
  "account.signOutDeviceHint":
    "Attempts to clear your saved sign-in details. You’ll be told if sign-out is incomplete.",
  "account.returningToSignIn": "Returning to sign in…",
  "account.title": "Your account",
  "account.authenticatedStatus": "✓ Signed in securely",
  "account.loadingProfile": "Loading your account details…",
  "account.profileRequestFailed": "Your account details couldn’t be loaded. Try again.",
  "account.retryProfile": "Try loading account again",
  "account.authenticatedUser": "Account holder",
  "account.userId": "Account ID",
  "account.profileIncomplete": "ℹ Some account details are missing.",
  "account.profileIncompleteDetail":
    "You are still signed in. Some account details could not be loaded.",
  "account.signOut": "Sign out",
  "account.signOutHint":
    "Removes saved sign-in details and asks the marketplace to end your session.",

  "session.secureStorageUnavailable":
    "Secure sign-in storage isn’t available on this device.",
  "session.recoveryUnavailable": "Session recovery is temporarily unavailable.",
  "session.storedSessionInvalid": "Stored session could not be restored safely.",
  "session.expired": "Your session has expired. Sign in again.",
  "session.invalid": "Your session is no longer valid. Sign in again.",
  "session.changedDuringAuth": "Session changed while authentication was completing.",
  "session.changedDuringPersistence":
    "Session changed while credentials were being persisted.",
  "session.noStoredSession": "No saved sign-in was found on this device.",
  "session.signoutPending": "Signing out and checking this device…",
  "session.signoutIncompleteTitle": "Finish signing out",
  "session.signoutIncomplete": "Sign-out is not complete. We could not verify that your saved sign-in details were removed. Retry before sharing this device.",
  "session.signoutLocalOnly": "Signed out on this device. We could not confirm that the server ended your session.",
  "session.signoutBlocked": "Complete the previous sign-out before signing in again.",
  "session.retrySignout": "Retry sign-out",
  "session.protectedWithoutSession":
    "Protected request attempted without an authenticated session.",
  "session.responseDiscarded":
    "Protected response was discarded because the session changed.",

  "trailbase.sessionInvalid":
    "Your sign-in has expired. Please sign in again.",
  "trailbase.refreshInvalid": "Your saved sign-in has expired. Please sign in again.",
  "trailbase.mfaRequired": "This account needs an extra verification step that is not available here yet.",
  "trailbase.loginMalformed": "We couldn’t complete sign-in. Please try again.",
  "trailbase.refreshMalformed": "We couldn’t restore your sign-in. Please sign in again.",
  "trailbase.malformedJson":
    "The marketplace sent an unexpected response (code {status}). Please retry.",
  "trailbase.httpFailure":
    "The marketplace request failed (code {status}). Please try again.",
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
