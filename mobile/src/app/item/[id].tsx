// MOB-02 — auction detail.
// Reads one record from the canonical authority (Trailbase via gateway).
// Bidding is intentionally not wired here: it belongs to MOB-03 and must go
// through the Socket.IO trade engine, never a direct record write.

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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/BottomNav";
import { formatDateTime, formatRemaining, formatUSD, minNextBid, remainingSeverity } from "../../lib/format";
import { fetchAuction } from "../../lib/trailbase";
import { biddingOwnershipToken, connectBidding, disconnectBidding, placeBid } from "../../lib/socket";
import { presentBidOutcome } from "../../lib/bid-copy";
import { runGuardedBid } from "../../bids/bid-completion";
import { useSession } from "../../auth/session-context";
import { toAuctionView, type AuctionView } from "../../lib/types";

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchAuction(Number(id));
      if (!record) {
        setError("This listing could not be found.");
        setItem(null);
      } else {
        const view = toAuctionView(record);
        setItem(view);
        setBidAmount((current) => current || String(minNextBid(view.current_price, view.bid_count)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the marketplace.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Live engine connection (MOB-03): token from the session, socket to :3002.
  useEffect(() => {
    let cancelled = false;
    if (session.phase !== "authenticated") {
      disconnectBidding();
      return () => {
        cancelled = true;
      };
    }
    void session
      .withAuthenticatedToken(async (token) => {
        const s = connectBidding(token);
        s.on("connect", () => !cancelled && setEngineUp(true));
        s.on("disconnect", () => !cancelled && setEngineUp(false));
        s.on("auction:update", (payload: { auction?: { id: number } }) => {
          if (!cancelled && payload?.auction?.id === Number(id)) void load();
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      disconnectBidding();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase, session.identity?.id, id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
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
    // state update inside the effect.
    const task = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const styles = useMemo(() => makeStyles(), []);
  const sold = item ? ["sold", "ended", "cancelled"].includes(item.status) : false;
  const remainingMs = item ? Date.parse(item.ends_at) - now : 0;
  const severity = item ? remainingSeverity(remainingMs) : "normal";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable hitSlop={4} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {item ? item.title : "Listing"}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#19717B" size="large" />
        </View>
      ) : error || !item ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Not available</Text>
          <Text style={styles.errorBody}>{error ?? "This listing is no longer published."}</Text>
          <Pressable hitSlop={4} style={styles.retry} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
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
                      <View style={[styles.heroImg, { backgroundColor: "#E7EDF0" }]} />
                    )}
                  </View>
                ))}
              </ScrollView>

              {sold && (
                <>
                  <View style={styles.soldVeil} pointerEvents="none" />
                  <View style={styles.soldBandWrap} pointerEvents="none">
                    <View style={styles.soldBand}>
                      <Text style={styles.soldBandText}>SOLD</Text>
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
                {item.featured ? <Text style={[styles.badge, styles.badgeGold]}>Featured</Text> : null}
              </View>

              <Text style={styles.title}>{item.title}</Text>

              <View style={styles.statRow}>
                <Stat label="Bids" value={String(item.bid_count)} />
                <Stat label="Watching" value={String(item.watch_count)} />
                <Stat label="Views" value={String(item.views)} />
              </View>

              {sold ? (
                <Text style={styles.closed}>This auction has closed.</Text>
              ) : (
                <Text style={[styles.timer, severity === "urgent" && styles.timerUrgent]}>
                  Ends in {formatRemaining(remainingMs)} · {formatDateTime(item.ends_at, { withTime: true })}
                </Text>
              )}
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>Seller</Text>
              <View style={styles.sellerRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.seller_username.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerName}>@{item.seller_username}</Text>
                  <Text style={styles.sellerMeta}>{item.city || "Zimbabwe"} · ships: {item.shipping}</Text>
                </View>
              </View>
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.body}>{item.description || "No description provided."}</Text>
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>Details</Text>
              <Row k="Starting price" v={formatUSD(item.start_price)} />
              <Row k="Shipping fee" v={formatUSD(item.shipping_fee)} />
              <Row k="Location" v={item.city || "—"} />
              <Row k="Listing ID" v={String(item.id)} />
            </View>
          </ScrollView>

          <View style={styles.ctaBar}>
            {sold ? (
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={styles.closed}>Auction closed · final {formatUSD(item.current_price)}</Text>
              </View>
            ) : session.phase !== "authenticated" ? (
              <>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaPrice}>{formatUSD(item.current_price)}</Text>
                  <Text style={styles.ctaSub}>Next minimum {formatUSD(minNextBid(item.current_price, item.bid_count))}</Text>
                </View>
                <Pressable hitSlop={4}
                  style={styles.cta}
                  onPress={() => router.push("/auth/login" as never)}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaText}>Sign in to bid</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.ctaSub}>
                    {engineUp ? "Live engine connected" : "Connecting to engine…"}
                  </Text>
                  <View style={styles.amountRow}>
                    <Text style={styles.amountPrefix}>US$</Text>
                    <TextInput
                      value={bidAmount}
                      onChangeText={setBidAmount}
                      keyboardType="decimal-pad"
                      style={styles.amountInput}
                      accessibilityLabel="Your maximum bid"
                      placeholder={String(minNextBid(item.current_price, item.bid_count))}
                      placeholderTextColor="#9AA7AE"
                    />
                  </View>
                  {bidNote && (
                    <Text
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
                <Pressable hitSlop={4}
                  disabled={bidding || !engineUp}
                  style={[styles.cta, (bidding || !engineUp) && styles.ctaDisabled]}
                  onPress={async () => {
                    const amount = Number(bidAmount);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      setBidNote({ tone: "error", text: "Enter a bid amount." });
                      return;
                    }
                    setBidding(true);
                    setBidNote(null);

                    // CLOSE-02: the completion is published only while this
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
                        identityId: identityRef.current,
                        connectionEpoch: biddingOwnershipToken(),
                      }),
                      place: () => placeBid(item.id, amount),
                      publish: (outcome) => {
                        const presented = presentBidOutcome(outcome, formatUSD);
                        setBidNote({ tone: presented.tone, text: presented.text });
                        setBidding(false);
                        // CLOSE-01: an unconfirmed acknowledgement is reconciled
                        // against canonical auction state, never assumed.
                        if (outcome.ok || presented.reconcile) void load();
                      },
                      onDiscarded: () => {
                        // No result is claimed. The screen may still be mounted
                        // after an account switch, so release the busy state.
                        if (mountedRef.current) setBidding(false);
                      },
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: bidding || !engineUp }}
                >
                  <Text style={styles.ctaText}>{bidding ? "Placing…" : "Place bid"}</Text>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={statStyle.wrap}>
      <Text style={statStyle.value}>{value}</Text>
      <Text style={statStyle.label}>{label}</Text>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={rowStyle.row}>
      <Text style={rowStyle.k}>{k}</Text>
      <Text style={rowStyle.v}>{v}</Text>
    </View>
  );
}

const statStyle = StyleSheet.create({
  wrap: { alignItems: "center", flex: 1 },
  value: { fontSize: 15, fontWeight: "800", color: "#101619" },
  label: { fontSize: 10.5, color: "#6B7A82", marginTop: 2 },
});

const rowStyle = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  k: { fontSize: 13, color: "#6B7A82" },
  v: { fontSize: 13, color: "#101619", fontWeight: "600" },
});

function makeStyles() {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: "#F6F9FA" },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: "#FFFFFF",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#DCE4E8",
    },
    backBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    backGlyph: { fontSize: 26, color: "#19717B", lineHeight: 28 },
    topTitle: { flex: 1, textAlign: "center", fontSize: 13, fontWeight: "700", color: "#101619" },

    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
    errorTitle: { fontSize: 18, fontWeight: "800", color: "#101619" },
    errorBody: { fontSize: 13, color: "#5C6B72", textAlign: "center" },
    retry: { marginTop: 10, backgroundColor: "#19717B", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
    retryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },

    scroll: { paddingBottom: 24 },
    heroWrap: { backgroundColor: "#FFFFFF" },
    hero: { width: 390, height: 390 },
    heroImg: { width: "100%", height: "100%" },
    soldVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,13,16,0.35)" },
    soldBandWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    soldBand: {
      width: 460,
      paddingVertical: 12,
      backgroundColor: "#D62828",
      borderTopWidth: 3,
      borderBottomWidth: 3,
      borderColor: "#FFFFFF",
      transform: [{ rotate: "-30deg" }],
      alignItems: "center",
    },
    soldBandText: { color: "#FFFFFF", fontWeight: "900", fontSize: 26, letterSpacing: 8 },
    dots: { position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
    dotOn: { backgroundColor: "#FFFFFF" },

    block: {
      backgroundColor: "#FFFFFF",
      marginTop: 8,
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 8,
    },
    price: { fontSize: 26, fontWeight: "900", color: "#8A5F0B", letterSpacing: -0.6 },
    priceSold: { color: "#7A848A", textDecorationLine: "line-through" },
    badges: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    badge: {
      fontSize: 10.5,
      fontWeight: "700",
      color: "#19717B",
      backgroundColor: "rgba(25,113,123,0.10)",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      overflow: "hidden",
    },
    badgeGold: { color: "#8A5F0B", backgroundColor: "rgba(223,174,46,0.18)" },
    title: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "#101619" },
    statRow: {
      flexDirection: "row",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: "#E2E8EC",
      paddingVertical: 10,
      marginTop: 4,
    },
    timer: { fontSize: 12.5, color: "#5C6B72" },
    timerUrgent: { color: "#C0392B", fontWeight: "700" },
    closed: { fontSize: 12.5, color: "#C0392B", fontWeight: "700" },

    sectionTitle: { fontSize: 13, fontWeight: "800", color: "#101619" },
    sellerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#19717B", alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
    sellerName: { fontSize: 14, fontWeight: "700", color: "#101619" },
    sellerMeta: { fontSize: 11.5, color: "#6B7A82", marginTop: 2 },
    body: { fontSize: 13.5, lineHeight: 20, color: "#33424A" },

    ctaBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: "#DCE4E8",
      backgroundColor: "#FFFFFF",
    },
    ctaPrice: { fontSize: 18, fontWeight: "900", color: "#8A5F0B" },
    ctaSub: { fontSize: 11, color: "#6B7A82" },
    cta: { paddingHorizontal: 18, minHeight: 48, justifyContent: "center", borderRadius: 12, backgroundColor: "#19717B" },
    ctaDisabled: { backgroundColor: "#9FB3B8" },
    amountRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    amountPrefix: { fontSize: 15, fontWeight: "800", color: "#8A5F0B" },
    amountInput: {
      minWidth: 96,
      minHeight: 48,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderWidth: 1.5,
      borderColor: "#19717B",
      borderRadius: 8,
      fontSize: 15,
      fontWeight: "700",
      color: "#101619",
      backgroundColor: "#FFFFFF",
    },
    bidNote: { fontSize: 10.5, marginTop: 2 },
    bidNoteOk: { color: "#1E7A4B" },
    bidNoteBad: { color: "#C0392B" },
    bidNoteWarn: { color: "#8A5A00" },
    bidNoteUnknown: { color: "#4A5A66" },
    ctaText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13.5 },
  });
}
