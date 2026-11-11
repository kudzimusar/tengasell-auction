// MOB-02 — auction detail built on NXS tokens, localization, and responsive geometry.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/BottomNav";
import { formatDateTime, formatRemaining, formatUSD, minNextBid, remainingSeverity } from "../../lib/format";
import { createRequestGuard } from "../../lib/request-guard";
import { fetchAuction } from "../../lib/trailbase";
import { toAuctionView, type AuctionView } from "../../lib/types";
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
  const loadGuard = useRef(createRequestGuard()).current;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    const req = loadGuard.next();
    setLoading(true);
    setError(null);
    try {
      const record = await fetchAuction(Number(id));
      if (!loadGuard.isCurrent(req)) return;
      if (!record) {
        setError(t("item.notFound"));
        setItem(null);
      } else {
        setItem(toAuctionView(record));
      }
    } catch (e) {
      if (!loadGuard.isCurrent(req)) return;
      setError(e instanceof Error ? e.message : t("item.reachFailed"));
    } finally {
      if (loadGuard.isCurrent(req)) setLoading(false);
    }
  }, [id, loadGuard, t]);

  useEffect(() => {
    const task = setTimeout(() => {
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
  const remainingMs = item ? Date.parse(item.ends_at) - now : 0;
  // Status can lag the clock: an auction past ends_at is closed here too.
  const sold = item
    ? ["sold", "ended", "cancelled"].includes(item.status) || remainingMs <= 0
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
            <View style={{ flex: 1 }}>
              <Text style={styles.ctaPrice}>{formatUSD(item.current_price)}</Text>
              <Text style={styles.ctaSub}>
                {sold
                  ? t("auction.closedLabel")
                  : t("item.nextBid", {
                      amount: formatUSD(minNextBid(item.current_price, item.bid_count)),
                    })}
              </Text>
            </View>
            <Pressable
              hitSlop={4}
              disabled
              style={[styles.cta, styles.ctaDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel={sold ? t("item.closedCta") : t("item.biddingNextCta")}
            >
              <Text style={styles.ctaText}>{sold ? t("item.closedCta") : t("item.biddingNextCta")}</Text>
            </Pressable>
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
    heroWrap: { backgroundColor: theme.surface.raised },
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
    ctaText: { color: theme.text.inverse, fontWeight: "800", fontSize: 14 },
  });
}
