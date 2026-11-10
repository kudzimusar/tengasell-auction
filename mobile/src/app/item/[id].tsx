// MOB-02 — auction detail.
// Reads one record from the canonical authority (Trailbase via gateway).
// Bidding is intentionally not wired here: it belongs to MOB-03 and must go
// through the Socket.IO trade engine, never a direct record write.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/BottomNav";
import { formatDateTime, formatRemaining, formatUSD, remainingSeverity } from "../../lib/format";
import { fetchAuction } from "../../lib/trailbase";
import { toAuctionView, type AuctionView } from "../../lib/types";

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<AuctionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [hero, setHero] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchAuction(Number(id));
      if (!record) {
        setError("This listing could not be found.");
        setItem(null);
      } else {
        setItem(toAuctionView(record));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the marketplace.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
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
            <View style={{ flex: 1 }}>
              <Text style={styles.ctaPrice}>{formatUSD(item.current_price)}</Text>
              <Text style={styles.ctaSub}>
                {sold ? "Auction closed" : `Next bid ${formatUSD(item.current_price + 1)}`}
              </Text>
            </View>
            <Pressable hitSlop={4}
              disabled
              style={[styles.cta, styles.ctaDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
            >
              <Text style={styles.ctaText}>{sold ? "Closed" : "Bidding in MOB-03"}</Text>
            </Pressable>
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
    ctaText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13.5 },
  });
}
