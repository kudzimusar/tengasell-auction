export const englishStrings = {
  "nav.signIn": "Sign in",
  "nav.account": "Account",
  "nav.home": "Home",
  "nav.categories": "Categories",
  "nav.search": "Search",
  "nav.orders": "Orders",
  "nav.you": "You",

  "common.tryAgain": "Try again",

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
  "home.recentlySold": "Recently sold",
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

  "auction.soldBadge": "SOLD",
  "auction.soldStatus": "sold",
  "auction.bidCount": "{count} bids",
  "auction.closedLabel": "Auction closed",
  "auction.endsRemaining": "Ends {remaining}",
  "auction.cardMeta": "{statusText} · @{seller}",
  "auction.cardSummarySold": "{title}, {price}, sold",
  "auction.cardSummaryLive": "{title}, {price}, {count} bids, {remaining} left",

  "categories.title": "Categories",
  "categories.all": "All",
  "categories.showAllA11y": "Show all categories",
  "categories.openCategoryA11y": "Browse {category} auctions",
  "categories.loadError": "Could not load categories. Check your connection and try again.",
  "categories.categoryError": "Could not load this category. Try again.",
  "categories.empty": "No listings in this category yet.",
  "categories.loadingA11y": "Loading categories",

  "search.placeholder": "Search live auctions — iPhone, solar, Hilux…",
  "search.inputA11y": "Search live auctions",
  "search.submit": "Search",
  "search.browseCategoryTitle": "Browse live auctions by category",
  "search.chipA11y": "Search live {category} auctions",
  "search.emptyNoResults": "No live auctions match that search.",
  "search.promptLiveOnly": "Search currently live auctions.",
  "search.unavailableError": "Search is unavailable right now. Try again.",
  "search.loadingA11y": "Searching live auctions",

  "orders.title": "Orders",
  "orders.emptyTitle": "No orders yet",
  "orders.signedOutTitle": "Sign in to see your orders",
  "orders.emptyBody": "When you win an auction, the order appears here with payment and delivery status.",
  "orders.signedOutBody": "Your bids, wins and delivery status live behind your account.",
  "orders.signIn": "Sign in",
  "orders.signInA11y": "Sign in to view your orders",

  "you.signedOutTitle": "Welcome to {brand}",
  "you.signedOutBody": "Sign in to view your profile, saved bids, and watchlist alerts.",
  "you.signInAction": "Sign in",
  "you.signInA11y": "Sign in to your {brand} account",

  "item.backA11y": "Back",
  "item.fallbackTitle": "Listing",
  "item.loadingA11y": "Loading listing",
  "item.notFound": "This listing could not be found.",
  "item.reachFailed": "Could not reach the marketplace.",
  "item.unavailableTitle": "Not available",
  "item.unavailableFallback": "This listing is no longer published.",
  "item.featured": "Featured",
  "item.bidsLabel": "Bids",
  "item.watchingLabel": "Watching",
  "item.viewsLabel": "Views",
  "item.closedBanner": "This auction has closed.",
  "item.endsInBanner": "Ends in {remaining} · {date}",
  "item.sellerTitle": "Seller",
  "item.defaultLocation": "Zimbabwe",
  "item.sellerMeta": "{city} · ships: {shipping}",
  "item.descriptionTitle": "Description",
  "item.noDescription": "No description provided.",
  "item.detailsTitle": "Details",
  "item.startingPrice": "Starting price",
  "item.shippingFee": "Shipping fee",
  "item.location": "Location",
  "item.listingId": "Listing ID",
  "item.nextBid": "Next bid {amount}",
  "item.closedCta": "Closed",
  "item.biddingNextCta": "Bidding in MOB-03",
  "item.closedSummary": "Auction closed · final {amount}",
  "item.nextMinimum": "Next minimum {amount}",
  "item.signInToBid": "Sign in to bid",
  "item.signInToBidA11y": "Sign in to place a bid",
  "item.engineConnected": "Live engine connected",
  "item.engineConnecting": "Connecting to engine…",
  "item.engineError": "Could not connect to live bidding engine.",
  "item.engineRetry": "Retry connection",
  "item.engineErrorRetryA11y": "Retry live bidding connection",
  "item.engineRevoked": "Session revoked or expired — sign in again to bid.",
  "item.engineRevokedSignInA11y": "Session invalidated. Sign in again to bid",
  "item.authRevokedBanner": "Your session is no longer active. Sign in again to place bids.",
  "item.currencyPrefix": "US$",
  "item.yourMaxBidA11y": "Your maximum bid",
  "item.enterBidAmount": "Enter a bid amount.",
  "item.minBidError": "Your maximum must be at least {amount}.",
  "item.ctaClosed": "Auction closed",
  "item.ctaPlacing": "Placing…",
  "item.ctaPlaceBid": "Place bid",

  "currency.usdAmount": "US${amount}",

  "bid.unconfirmed":
    "We could not confirm this bid. It may still have reached the auction — checking the current bid before you place another bid.",
  "bid.notAccepted": "The bid was not accepted.",
  "bid.rejectedWithReason": "Bid rejected: {reason}",
  "bid.inconsistent":
    "The auction engine returned an inconsistent confirmation. Checking the current bid before showing a result.",
  "bid.outbidStanding": "You were outbid — the standing bid is {amount}.",
  "bid.outbidCovered": "You were outbid — a standing automatic bid covered your maximum.",
  "bid.leadingAt": "You're the leading bidder at {amount}.",
  "bid.leading": "You're the leading bidder.",
  "bid.acceptedNotLeadingAt": "Bid accepted at {amount}, but you are not leading.",
  "bid.acceptedNotLeading": "Bid accepted, but you are not leading.",
  "bid.acceptedPositionUnknown":
    "Your bid was accepted. The engine did not confirm your position — checking the current bid.",

  "bid.notConnected": "Not connected to the live auction engine.",
  "bid.code.AUTH_REQUIRED": "Sign in to place bids.",
  "bid.code.AUTH_INVALID": "Your session could not be verified. Sign in again.",
  "bid.code.AUTH_EXPIRED": "Your session expired. Sign in again.",
  "bid.code.AUTH_REVOKED": "Your session was revoked. Sign in again.",
  "bid.code.AUTH_UNAVAILABLE": "Could not verify your session right now. Check your connection.",
  "bid.code.PROFILE_MISSING": "Account profile missing — reload and try again.",
  "bid.code.AUCTION_NOT_FOUND": "This auction could not be found.",
  "bid.code.AUCTION_LOOKUP_FAILED": "Could not verify auction state right now. Try again.",
  "bid.code.AUCTION_NOT_LIVE": "This auction is no longer live.",
  "bid.code.AUCTION_ENDED": "This auction has ended.",
  "bid.code.SELF_BID": "You cannot bid on your own auction.",
  "bid.code.ALREADY_LEADING": "You are already the highest bidder on this auction.",
  "bid.code.INVALID_AMOUNT": "Enter a valid maximum bid.",
  "bid.code.BELOW_MINIMUM": "Your bid is below the current minimum increment.",
  "bid.code.BELOW_START_PRICE": "Your bid is below the opening price.",
  "bid.code.BID_LEDGER_UNAVAILABLE": "Could not verify current bids right now. Try again.",
  "bid.code.INVALID_AUCTION": "Invalid auction selected.",
  "bid.code.INVALID_REQUEST_ID": "Invalid bid request reference.",
  "bid.code.IDEMPOTENCY_CONFLICT": "This bid request conflicted with an earlier bid reference.",
  "bid.code.RATE_LIMITED": "Too many bid attempts — wait a moment before bidding.",
  "bid.code.WRITE_REJECTED": "The auction rejected the bid before recording it.",

  "bid.reconcileUnreachable":
    "We could not confirm this bid — it may still have reached the auction, and live records are unreachable right now. Refresh before placing another bid.",
  "bid.reconcileAuctionMissing":
    "We could not confirm this bid because the listing record is unavailable. Refresh before placing another bid.",
  "bid.reconcileLeadingAt": "Live auction records confirm you're the leading bidder at {amount}.",
  "bid.reconcileLeading": "Live auction records confirm you're the leading bidder.",
  "bid.reconcileOutbidAt":
    "Live auction records confirm your bid reached the auction (current price {amount}), and you were outbid.",
  "bid.reconcileOutbid":
    "Live auction records confirm your bid reached the auction, and you were outbid.",
  "bid.reconcileStillInFlightAt":
    "We could not confirm this bid — it may still have reached the auction (live price {amount}). Refresh and verify bid history before bidding again.",
  "bid.reconcileStillInFlight":
    "We could not confirm this bid — it may still have reached the auction. Refresh and verify bid history before bidding again.",
  "bid.reconcileUnrecordedAt":
    "No new bid from your account appears in live records (current price {amount}). Verify bid history before placing another bid.",
  "bid.reconcileUnrecorded":
    "No new bid from your account appears in live records. Verify bid history before placing another bid.",

  "condition.new": "Brand new",
  "condition.likeNew": "Like new",
  "condition.mint": "Mint",
  "condition.used": "Used — good",
  "condition.good": "Good",
  "condition.fair": "Used — fair",
  "condition.refurbished": "Refurbished",
  "condition.forParts": "For parts / not working",
  "condition.unknown": "Condition: {value}",

  "shipping.pickup": "Local pickup only",
  "shipping.pickupPaid": "Pickup + delivery — {fee}",
  "shipping.courierFree": "Free courier nationwide",
  "shipping.courierPaid": "Courier — {fee}",
  "shipping.nationalFree": "Free nationwide shipping",
  "shipping.nationalPaid": "Nationwide — {fee}",
  "shipping.both": "Pickup or delivery",
  "shipping.custom": "Shipping: {value}",

  "category.electronics": "Electronics",
  "category.phones": "Phones & tablets",
  "category.solar": "Solar & power",
  "category.vehicles": "Vehicles",
  "category.home": "Home & garden",
  "category.fashion": "Fashion",
  "category.tools": "Tools",
  "category.collectibles": "Collectibles",
  "category.other": "Other",
  "category.custom": "Category: {value}",
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
