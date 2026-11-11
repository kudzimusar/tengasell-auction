// MOB-03 + NXS — auction detail with live bidding over the Socket.IO trade engine.
// Reads canonical listing state from TrailBase via gateway, and dispatches
// proxy bids solely through the Socket.IO trade engine (:3002), never a direct
// record write to `bids` or `auctions`.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../../auth/session-context";
import { runGuardedBid } from "../../bids/bid-completion";
import { reconcileBidOutcome } from "../../bids/bid-reconcile";
import { BottomNav } from "../../components/BottomNav";
import { presentBidOutcome } from "../../lib/bid-copy";
import { formatDateTime, formatRemaining, formatUSD, minNextBid, remainingSeverity } from "../../lib/format";
import { biddingOwnershipToken, connectBidding, disconnectBidding, placeBid } from "../../lib/socket";
import { fetchAuction } from "../../lib/trailbase";
import { fetchAuctionBids, readCanonicalBidSnapshot } from "../../lib/trailbase-bids";
import { toAuctionView, type AuctionView, type Bid } from "../../lib/types";
import { NxsButton } from "../../nxs/components/NxsButton";
import { useNxs } from "../../nxs/context/NxsProvider";
import { useNxsText } from "../../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../../nxs/tokens";

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { theme, screenPadding, safeArea, writingDirection } = useNxs();
  const t = useNxsText();

  const [item, setItem] = useState<AuctionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(() => Date.now());
  const [hero, setHero] = useState(0);
  const session = useSession();
  const [bidAmount, setBidAmount] = useState("");
  const [bidding, setBidding] = useState(false);
  const [bidNote, setBidNote] = useState<{
    tone: "success" | "warning" | "error" | "unknown";
    text: string;
  } | null>(null);
  const [engineUp, setEngineUp] = useState(false);
  const mountedRef = useRef(true);
  // The session object captured by this render cannot observe a later account
  // switch. Read identity through a ref that tracks the latest snapshot.
  const identityRef = useRef<string | null>(session.identity?.id ?? null);
  const loadSeqRef = useRef(0);
  const itemRef = useRef<AuctionView | null>(null);
  const bidsSnapshotRef = useRef<{ auctionId: number; loaded: boolean; bids: Bid[] }>({
    auctionId: 0,
    loaded: false,
    bids: [],
  });

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const seq = ++loadSeqRef.current;
      const auctionId = Number(id);
      const silent =
        opts?.silent === true &&
        itemRef.current !== null &&
        itemRef.current.id === auctionId;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const [record, recentBids] = await Promise.all([
          fetchAuction(auctionId),
          fetchAuctionBids(auctionId, 15).catch(() => null),
        ]);
        if (seq !== loadSeqRef.current || !mountedRef.current) return;
        if (!record) {
          if (!silent) {
            setError(t("item.notFound"));
            itemRef.current = null;
            setItem(null);
            bidsSnapshotRef.current = { auctionId, loaded: false, bids: [] };
          }
        } else {
          const view = toAuctionView(record);
          itemRef.current = view;
          setItem(view);
          if (recentBids !== null) {
            bidsSnapshotRef.current = { auctionId, loaded: true, bids: recentBids };
          }
          setBidAmount((current) => current || String(minNextBid(view.current_price, view.bid_count)));
        }
      } catch (e) {
        if (seq !== loadSeqRef.current || !mountedRef.current) return;
        if (!silent) {
          setError(e instanceof Error ? e.message : t("item.reachFailed"));
        }
      } finally {
        if (seq === loadSeqRef.current && mountedRef.current && !silent) {
          setLoading(false);
        }
      }
    },
    [id, t],
  );

  // Live engine connection (MOB-03): token from the session, socket to :3002.
  useEffect(() => {
    let cancelled = false;
    // Clear any prior account's bid banner/pending flag whenever auth or item shifts.
    const clearStale = setTimeout(() => {
      if (!cancelled) {
        setBidNote(null);
        setBidding(false);
      }
    }, 0);
    if (session.phase !== "authenticated") {
      disconnectBidding();
      // Deferred: resetting the flag synchronously inside the effect would
      // cascade a render. The CTA must not stay enabled once the session is gone.
      const reset = setTimeout(() => {
        if (!cancelled) setEngineUp(false);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(clearStale);
        clearTimeout(reset);
      };
    }
    void session
      .withAuthenticatedToken(async (token) => {
        // The token refresh can resolve after this effect was torn down; a
        // connect at that point would dispose whatever socket now owns bidding.
        if (cancelled) return;
        const s = connectBidding(token);
        s.on("connect", () => !cancelled && setEngineUp(true));
        s.on("disconnect", () => !cancelled && setEngineUp(false));
        s.on("auction:update", (payload: { auction?: { id: number } }) => {
          if (!cancelled && payload?.auction?.id === Number(id)) void load({ silent: true });
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      clearTimeout(clearStale);
      disconnectBidding();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase, session.identity?.id, id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    identityRef.current = session.identity?.id ?? null;
  }, [session.identity?.id]);

  useEffect(() => {
    // Deferred one tick so the first paint is not blocked by a synchronous
    // state update inside the effect. Reset per-listing fields only when the
    // route `id` changes; live `auction:update` calls `load()` directly.
    const task = setTimeout(() => {
      setHero(0);
      setBidAmount("");
      setBidNote(null);
      void load();
    }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const usableWidth = Math.max(320, width - safeArea.left - safeArea.right);
  const containerWidth = Math.min(usableWidth, 720);
  const heroWidth = containerWidth;
  const styles = useMemo(
    () => makeStyles(theme, screenPadding, writingDirection, containerWidth, heroWidth),
    [containerWidth, heroWidth, screenPadding, theme, writingDirection],
  );
  const endsMs = item ? Date.parse(item.ends_at) : NaN;
  const remainingMs = Number.isFinite(endsMs) ? endsMs - now : 0;
  // The record status can lag the clock. An auction past its end time or with a
  // malformed end timestamp is closed here too, otherwise the detail screen
  // offers a bid on an ended lot while the card already says it is closed.
  const sold = item
    ? ["sold", "ended", "cancelled"].includes(item.status) || !Number.isFinite(endsMs) || remainingMs <= 0
    : false;
  const severity = item ? remainingSeverity(remainingMs) : "normal";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable
          hitSlop={4}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("item.backA11y")}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1} accessibilityRole="header">
          {item ? item.title : t("item.fallbackTitle")}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator
            color={theme.state.loading}
            size="large"
            accessibilityLabel={t("item.loadingA11y")}
          />
        </View>
      ) : error || !item ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle} accessibilityRole="header">
            {t("item.unavailableTitle")}
          </Text>
          <Text style={styles.errorBody} accessibilityRole="alert">
            {error ?? t("item.unavailableFallback")}
          </Text>
          <NxsButton label={t("common.tryAgain")} onPress={() => void load()} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.heroWrap}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const w = e.nativeEvent.layoutMeasurement.width;
                  setHero(Math.round(e.nativeEvent.contentOffset.x / Math.max(w, 1)));
                }}
              >
                {(item.imageList.length ? item.imageList : [""]).map((uri: string, i: number) => (
                  <View key={i} style={styles.hero}>
                    {uri ? (
                      <Image source={{ uri }} style={styles.heroImg} resizeMode="cover" />
                    ) : (
                      <View style={[styles.heroImg, styles.heroPlaceholder]} />
                    )}
                  </View>
                ))}
              </ScrollView>

              {sold && (
                <>
                  <View style={styles.soldVeil} pointerEvents="none" />
                  <View style={styles.soldBandWrap} pointerEvents="none">
                    <View style={styles.soldBand}>
                      <Text style={styles.soldBandText}>{t("auction.soldBadge")}</Text>
                    </View>
                  </View>
                </>
              )}

              {item.imageList.length > 1 && (
                <View style={styles.dots}>
                  {item.imageList.map((_: string, i: number) => (
                    <View key={i} style={[styles.dot, i === hero && styles.dotOn]} />
                  ))}
                </View>
              )}
            </View>

            <View style={styles.block}>
              <Text style={[styles.price, sold && styles.priceSold]}>{formatUSD(item.current_price)}</Text>
              <View style={styles.badges}>
                <Text style={styles.badge}>{item.condition}</Text>
                <Text style={styles.badge}>{item.category}</Text>
                {item.featured ? <Text style={[styles.badge, styles.badgeGold]}>{t("item.featured")}</Text> : null}
              </View>

              <Text style={styles.title} accessibilityRole="header">
                {item.title}
              </Text>

              <View style={styles.statRow}>
                <Stat label={t("item.bidsLabel")} value={String(item.bid_count)} styles={styles} />
                <Stat label={t("item.watchingLabel")} value={String(item.watch_count)} styles={styles} />
                <Stat label={t("item.viewsLabel")} value={String(item.views)} styles={styles} />
              </View>

              {sold ? (
                <Text style={styles.closed}>{t("item.closedBanner")}</Text>
              ) : (
                <Text style={[styles.timer, severity === "urgent" && styles.timerUrgent]}>
                  {t("item.endsInBanner", {
                    remaining: formatRemaining(remainingMs),
                    date: formatDateTime(item.ends_at, { withTime: true }),
                  })}
                </Text>
              )}
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {t("item.sellerTitle")}
              </Text>
              <View style={styles.sellerRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.seller_username.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerName}>@{item.seller_username}</Text>
                  <Text style={styles.sellerMeta}>
                    {t("item.sellerMeta", {
                      city: item.city || t("item.defaultLocation"),
                      shipping: item.shipping,
                    })}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {t("item.descriptionTitle")}
              </Text>
              <Text style={styles.body}>{item.description || t("item.noDescription")}</Text>
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {t("item.detailsTitle")}
              </Text>
              <Row k={t("item.startingPrice")} v={formatUSD(item.start_price)} styles={styles} />
              <Row k={t("item.shippingFee")} v={formatUSD(item.shipping_fee)} styles={styles} />
              <Row k={t("item.location")} v={item.city || "—"} styles={styles} />
              <Row k={t("item.listingId")} v={String(item.id)} styles={styles} />
            </View>
          </ScrollView>

          <View style={styles.ctaBar}>
            {sold ? (
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={styles.closed}>
                  {t("item.closedSummary", { amount: formatUSD(item.current_price) })}
                </Text>
              </View>
            ) : session.phase !== "authenticated" ? (
              <>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaPrice}>{formatUSD(item.current_price)}</Text>
                  <Text style={styles.ctaSub}>
                    {t("item.nextMinimum", {
                      amount: formatUSD(minNextBid(item.current_price, item.bid_count)),
                    })}
                  </Text>
                </View>
                <Pressable
                  hitSlop={4}
                  style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                  onPress={() => router.push("/auth/login" as never)}
                  accessibilityRole="button"
                  accessibilityLabel={t("item.signInToBidA11y")}
                >
                  <Text style={styles.ctaText}>{t("item.signInToBid")}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.ctaSub}>
                    {engineUp ? t("item.engineConnected") : t("item.engineConnecting")}
                  </Text>
                  <View style={styles.amountRow}>
                    <Text style={styles.amountPrefix}>{t("item.currencyPrefix")}</Text>
                    <TextInput
                      value={bidAmount}
                      onChangeText={setBidAmount}
                      keyboardType="decimal-pad"
                      style={styles.amountInput}
                      accessibilityLabel={t("item.yourMaxBidA11y")}
                      placeholder={String(minNextBid(item.current_price, item.bid_count))}
                      placeholderTextColor={theme.text.secondary}
                    />
                  </View>
                  {bidNote && (
                    <Text
                      accessibilityRole="alert"
                      style={[
                        styles.bidNote,
                        bidNote.tone === "success" && styles.bidNoteOk,
                        bidNote.tone === "warning" && styles.bidNoteWarn,
                        bidNote.tone === "error" && styles.bidNoteBad,
                        bidNote.tone === "unknown" && styles.bidNoteUnknown,
                      ]}
                    >
                      {bidNote.text}
                    </Text>
                  )}
                </View>
                <Pressable
                  hitSlop={4}
                  disabled={bidding || !engineUp || sold}
                  style={({ pressed }) => [
                    styles.cta,
                    (bidding || !engineUp || sold) && styles.ctaDisabled,
                    pressed && styles.pressed,
                  ]}
                  onPress={async () => {
                    const amount = Number(bidAmount);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      setBidNote({ tone: "error", text: t("item.enterBidAmount") });
                      return;
                    }
                    // The field is prefilled from the tiered minimum, but typing
                    // is free: refuse locally rather than round-tripping a bid
                    // the engine will reject.
                    const minimum = minNextBid(item.current_price, item.bid_count);
                    if (amount < minimum) {
                      setBidNote({
                        tone: "error",
                        text: t("item.minBidError", { amount: formatUSD(minimum) }),
                      });
                      return;
                    }
                    setBidding(true);
                    setBidNote(null);

                    const targetAuctionId = item.id;
                    const buyerIdentityId = identityRef.current;
                    const baselineBidCount = item.bid_count;
                    const snap = bidsSnapshotRef.current;
                    const baselineTopBidId =
                      snap.auctionId === targetAuctionId && snap.loaded
                        ? (snap.bids[0]?.id ?? 0)
                        : null;

                    // CLOSE-02 / CERT-02: the completion and any canonical
                    // post-ack reconciliation are published only while this
                    // screen, this session and this connection still own it.
                    await runGuardedBid({
                      guard: {
                        sessionGeneration: () => session.sessionGeneration(),
                        identityId: () => identityRef.current,
                        isConnectionCurrent: (epoch) => biddingOwnershipToken() === epoch,
                        isMounted: () => mountedRef.current,
                      },
                      takeOwnership: () => ({
                        sessionGeneration: session.sessionGeneration(),
                        identityId: buyerIdentityId,
                        connectionEpoch: biddingOwnershipToken(),
                      }),
                      place: () => placeBid(targetAuctionId, amount),
                      reconcile: async (outcome) => {
                        const reconciled = await reconcileBidOutcome(
                          outcome,
                          {
                            auctionId: targetAuctionId,
                            identityId: buyerIdentityId,
                            maxAmount: amount,
                            beforeTopBidId: baselineTopBidId,
                            beforeBidCount: baselineBidCount,
                          },
                          formatUSD,
                          readCanonicalBidSnapshot,
                        );
                        return (
                          reconciled ?? {
                            outcome,
                            presentation: presentBidOutcome(outcome, formatUSD),
                            auction: null,
                          }
                        );
                      },
                      publish: (reconciled) => {
                        const presented = reconciled.presentation ?? presentBidOutcome(reconciled.outcome, formatUSD);
                        if (reconciled.auction) {
                          const nextView = toAuctionView(reconciled.auction);
                          itemRef.current = nextView;
                          setItem(nextView);
                        }
                        if (reconciled.bids) {
                          bidsSnapshotRef.current = {
                            auctionId: targetAuctionId,
                            loaded: true,
                            bids: reconciled.bids,
                          };
                        }
                        setBidNote({ tone: presented.tone, text: presented.text });
                        setBidding(false);
                        // CLOSE-01: keep UI synchronized silently without blanking bidNote.
                        if (reconciled.outcome.ok || presented.reconcile) void load({ silent: true });
                      },
                      onDiscarded: () => {
                        // No result is claimed. The screen may still be mounted
                        // after an account switch, so release the busy state.
                        if (mountedRef.current) setBidding(false);
                      },
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: bidding || !engineUp || sold }}
                  accessibilityLabel={
                    sold
                      ? t("item.ctaClosed")
                      : bidding
                        ? t("item.ctaPlacing")
                        : t("item.ctaPlaceBid")
                  }
                >
                  <Text style={styles.ctaText}>
                    {sold
                      ? t("item.ctaClosed")
                      : bidding
                        ? t("item.ctaPlacing")
                        : t("item.ctaPlaceBid")}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.statWrap}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({
  k,
  v,
  styles,
}: {
  k: string;
  v: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailKey}>{k}</Text>
      <Text style={styles.detailValue}>{v}</Text>
    </View>
  );
}

function makeStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
  containerWidth: number,
  heroWidth: number,
) {
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";
  const textAlign = writingDirection === "rtl" ? "right" : "left";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    topBar: {
      flexDirection: rowDirection,
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    backBtn: {
      width: nxsTokens.touch.minimum,
      height: nxsTokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    backGlyph: { fontSize: 26, color: theme.action.primary, lineHeight: 28 },
    pressed: { opacity: 0.78 },
    topTitle: {
      flex: 1,
      textAlign: "center",
      fontSize: 14,
      fontWeight: "700",
      color: theme.text.primary,
    },

    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    errorTitle: { fontSize: 18, fontWeight: "800", color: theme.text.primary },
    errorBody: { fontSize: 14, color: theme.text.secondary, textAlign: "center" },

    scroll: {
      width: "100%",
      maxWidth: containerWidth,
      alignSelf: "center",
      paddingBottom: 24,
    },
    heroWrap: { backgroundColor: theme.surface.raised, overflow: "hidden" },
    hero: { width: heroWidth, height: Math.min(heroWidth, 440) },
    heroImg: { width: "100%", height: "100%" },
    heroPlaceholder: { backgroundColor: theme.surface.overlay },
    soldVeil: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.surface.scrim,
    },
    soldBandWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    soldBand: {
      width: heroWidth * 1.4,
      paddingVertical: 12,
      backgroundColor: theme.state.error,
      borderTopWidth: 3,
      borderBottomWidth: 3,
      borderColor: theme.text.inverse,
      transform: [{ rotate: "-30deg" }],
      alignItems: "center",
    },
    soldBandText: { color: theme.text.inverse, fontWeight: "900", fontSize: 26, letterSpacing: 8 },
    dots: { position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.surface.scrim },
    dotOn: { backgroundColor: theme.text.inverse },

    block: {
      backgroundColor: theme.surface.raised,
      marginTop: 8,
      paddingHorizontal: screenPadding,
      paddingVertical: 14,
      gap: 8,
    },
    price: { fontSize: 26, fontWeight: "900", color: theme.state.warning, letterSpacing: -0.6, textAlign },
    priceSold: { color: theme.state.disabled, textDecorationLine: "line-through" },
    badges: { flexDirection: rowDirection, gap: 6, flexWrap: "wrap" },
    badge: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.action.primary,
      backgroundColor: theme.surface.primaryTint,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: nxsTokens.radius.pill,
      overflow: "hidden",
    },
    badgeGold: { color: theme.state.warning, backgroundColor: theme.surface.accentTint },
    title: { fontSize: 17, lineHeight: 23, fontWeight: "700", color: theme.text.primary, textAlign },
    statRow: {
      flexDirection: rowDirection,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      paddingVertical: 10,
      marginTop: 4,
    },
    statWrap: { alignItems: "center", flex: 1 },
    statValue: { fontSize: 15, fontWeight: "800", color: theme.text.primary },
    statLabel: { fontSize: 11, color: theme.text.secondary, marginTop: 2 },
    timer: { fontSize: 13, color: theme.text.secondary, textAlign },
    timerUrgent: { color: theme.state.error, fontWeight: "700" },
    closed: { fontSize: 13, color: theme.state.error, fontWeight: "700", textAlign },

    sectionTitle: { fontSize: 14, fontWeight: "800", color: theme.text.primary, textAlign },
    sellerRow: { flexDirection: rowDirection, alignItems: "center", gap: 10 },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.action.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: theme.text.inverse, fontWeight: "800", fontSize: 16 },
    sellerName: { fontSize: 14, fontWeight: "700", color: theme.text.primary, textAlign },
    sellerMeta: { fontSize: 12, color: theme.text.secondary, marginTop: 2, textAlign },
    body: { fontSize: 14, lineHeight: 21, color: theme.text.primary, textAlign },

    detailRow: { flexDirection: rowDirection, justifyContent: "space-between", paddingVertical: 6 },
    detailKey: { fontSize: 13, color: theme.text.secondary },
    detailValue: { fontSize: 13, color: theme.text.primary, fontWeight: "600" },

    ctaBar: {
      width: "100%",
      maxWidth: containerWidth,
      alignSelf: "center",
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 12,
      paddingHorizontal: screenPadding,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
      backgroundColor: theme.surface.section,
    },
    ctaPrice: { fontSize: 18, fontWeight: "900", color: theme.state.warning, textAlign },
    ctaSub: { fontSize: 12, color: theme.text.secondary, textAlign },
    cta: {
      paddingHorizontal: 18,
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      borderRadius: nxsTokens.radius.card,
      backgroundColor: theme.action.primary,
    },
    ctaDisabled: { backgroundColor: theme.state.disabled },
    amountRow: { flexDirection: rowDirection, alignItems: "center", gap: 4 },
    amountPrefix: { fontSize: 15, fontWeight: "800", color: theme.state.warning },
    amountInput: {
      minWidth: 96,
      minHeight: nxsTokens.touch.minimum,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderWidth: 1.5,
      borderColor: theme.action.primary,
      borderRadius: nxsTokens.radius.input,
      fontSize: 15,
      fontWeight: "700",
      color: theme.text.primary,
      backgroundColor: theme.surface.raised,
      textAlign,
    },
    bidNote: { fontSize: 12, lineHeight: 16, marginTop: 2, textAlign },
    bidNoteOk: { color: theme.state.success },
    bidNoteBad: { color: theme.state.error },
    bidNoteWarn: { color: theme.state.warning },
    bidNoteUnknown: { color: theme.text.secondary },
    ctaText: { color: theme.text.inverse, fontWeight: "800", fontSize: 14 },
  });
}
