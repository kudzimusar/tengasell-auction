import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../auth/session-context";
import { AuctionCard } from "../components/AuctionCard";
import { BottomNav } from "../components/BottomNav";
import { SearchHeader } from "../components/SearchHeader";
import { localizedCategoryLabel } from "../lib/format";
import { computeGridMetrics } from "../lib/grid-layout";
import {
  endingSoon,
  recommendedForHome,
  type HistorySignals,
  type Recommendation,
} from "../lib/recommend";
import { createRequestGuard } from "../lib/request-guard";
import { fetchAuctions, fetchCategories, probeCanonical } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
  getSearchHistory,
  getUserPreferences,
} from "../lib/user-store";
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { type NxsTranslator } from "../nxs/localization/catalog";
import { localizeKnownRuntimeMessage } from "../nxs/localization/runtimeMessages";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

const BRAND = "TengaSell";

type AuthorityState = "checking" | "live" | "unavailable";

function errorMessage(error: unknown, t: NxsTranslator): string {
  return error instanceof Error
    ? localizeKnownRuntimeMessage(error.message, t, "common.genericUnavailable")
    : t("common.genericUnavailable");
}

export default function HomeScreen() {
  const session = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { theme, screenPadding, safeArea, writingDirection } = useNxs();
  const t = useNxsText();
  const grid = useMemo(
    () =>
      computeGridMetrics({
        viewportWidth: width,
        columns: 2,
        padding: screenPadding,
        safeLeft: safeArea.left,
        safeRight: safeArea.right,
      }),
    [safeArea.left, safeArea.right, screenPadding, width],
  );
  const styles = useMemo(
    () => createStyles(theme, screenPadding, writingDirection, grid.containerWidth, grid.gap),
    [grid.containerWidth, grid.gap, screenPadding, theme, writingDirection],
  );
  const listRequestGuard = useRef(createRequestGuard()).current;
  const [authorityState, setAuthorityState] = useState<AuthorityState>("checking");
  const [categories, setCategories] = useState<Category[]>([]);
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [sold, setSold] = useState<AuctionView[]>([]);
  const [recentlyViewedItems, setRecentlyViewedItems] = useState<AuctionView[]>([]);
  const [recommendations, setRecommendations] = useState<{
    basis: "history" | "diverse";
    items: Recommendation[];
  }>({ basis: "diverse", items: [] });
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const initialTick = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(initialTick);
      clearInterval(timer);
    };
  }, []);

  const loadUserData = useCallback(async (allAuctions: AuctionView[]) => {
    const userId = session.identity?.id ?? null;
    const [prefs, historyQueries, viewed] = await Promise.all([
      getUserPreferences(),
      getSearchHistory(userId),
      getRecentlyViewed(userId),
    ]);

    // Filter viewed items to those currently available in the live or recent pool
    const validViewed = viewed.filter((it) => it && it.id);
    setRecentlyViewedItems(validViewed.slice(0, 6));

    if (allAuctions.length > 0) {
      const historySignals: HistorySignals | null =
        prefs.personalizationEnabled && prefs.historyEnabled
          ? {
              recentQueries: historyQueries,
              viewedCategories: validViewed.map((v) => v.category).filter(Boolean),
            }
          : null;

      const recs = recommendedForHome(allAuctions, historySignals, {
        now: Date.now(),
        limit: 8,
        maxPerSeller: 2,
      });
      setRecommendations(recs);
    }
  }, [session.identity?.id]);

  const boot = useCallback(async () => {
    const request = listRequestGuard.next();
    try {
      await probeCanonical();
      const [nextCategories, nextAuctions, nextSold] = await Promise.all([
        fetchCategories(),
        fetchAuctions({ limit: 40 }),
        fetchAuctions({ status: "sold", limit: 6 }).catch(() => []),
      ]);
      if (!listRequestGuard.isCurrent(request)) return;
      const parsedAuctions = nextAuctions.map(toAuctionView);
      setCategories(nextCategories);
      setAuctions(parsedAuctions);
      setSold(nextSold.map(toAuctionView));
      setAuthorityState("live");
      setError(null);
      void loadUserData(parsedAuctions);
    } catch (bootError) {
      if (!listRequestGuard.isCurrent(request)) return;
      setCategories([]);
      setAuctions([]);
      setAuthorityState("unavailable");
      setError(errorMessage(bootError, t));
    }
  }, [listRequestGuard, loadUserData, t]);

  useEffect(() => {
    const task = setTimeout(() => {
      void boot();
    }, 0);
    return () => clearTimeout(task);
  }, [boot]);

  const retryCanonical = useCallback(() => {
    setAuthorityState("checking");
    setError(null);
    void boot();
  }, [boot]);

  const loadCategory = useCallback(
    async (slug?: string) => {
      const request = listRequestGuard.next();
      setCategory(slug);
      setListLoading(true);
      setError(null);
      try {
        const nextAuctions = await fetchAuctions({ category: slug, limit: 40 });
        if (!listRequestGuard.isCurrent(request)) return;
        setAuctions(nextAuctions.map(toAuctionView));
        setAuthorityState("live");
      } catch (loadError) {
        if (!listRequestGuard.isCurrent(request)) return;
        setAuctions([]);
        setError(errorMessage(loadError, t));
      } finally {
        if (listRequestGuard.isCurrent(request)) setListLoading(false);
      }
    },
    [listRequestGuard, t],
  );

  const handleClearRecentlyViewed = async () => {
    await clearRecentlyViewed(session.identity?.id ?? null);
    setRecentlyViewedItems([]);
  };

  const emptyAction = category ? (
    <NxsButton
      label={t("home.showFeaturedAuctions")}
      variant="secondary"
      onPress={() => void loadCategory(undefined)}
    />
  ) : (
    <NxsButton
      label={t("home.refreshAuctions")}
      variant="secondary"
      onPress={retryCanonical}
    />
  );

  const sessionInvalidMessage = localizeKnownRuntimeMessage(
    session.message,
    t,
    "home.sessionInvalidFallback",
  );
  const sessionRecoveryMessage = localizeKnownRuntimeMessage(
    session.message,
    t,
    "home.sessionRecoveryUnavailable",
  );

  const endingSoonList = useMemo(() => {
    return endingSoon(auctions, { now, limit: 6 });
  }, [auctions, now]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* Search-First Top Header */}
      <SearchHeader />

      <View
        style={styles.authorityRow}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          authorityState === "checking"
            ? t("home.authorityCheckingA11y")
            : authorityState === "live"
              ? t("home.authorityConnectedA11y")
              : t("home.authorityUnavailableA11y")
        }
      >
        <Text style={styles.authorityText}>
          {authorityState === "checking"
            ? t("home.authorityChecking")
            : authorityState === "live"
              ? t("home.authorityConnected")
              : t("home.authorityUnavailable")}
        </Text>
      </View>

      {(session.phase === "signout-pending" ||
        session.phase === "signout-incomplete" ||
        session.phase === "signed-out-locally") && (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>
            {session.phase === "signout-pending"
              ? t("session.signoutPending")
              : session.phase === "signout-incomplete"
                ? t("session.signoutIncomplete")
                : t("session.signoutLocalOnly")}
          </Text>
          {session.phase === "signout-incomplete" && (
            <NxsButton
              label={t("session.retrySignout")}
              variant="destructive"
              onPress={() => void session.retryLogout()}
            />
          )}
        </View>
      )}

      {session.phase === "session-invalid" && (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>⚠ {sessionInvalidMessage}</Text>
        </View>
      )}

      {session.phase === "network-degraded" && (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>⚠ {sessionRecoveryMessage}</Text>
          <NxsButton
            label={t("home.retrySession")}
            variant="secondary"
            onPress={() => void session.retrySessionRecovery()}
          />
        </View>
      )}

      {error && authorityState === "live" && (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            {t("common.errorWithMessage", { message: error })}
          </Text>
          <NxsButton
            label={t("home.retryAuctionRequest")}
            variant="secondary"
            onPress={() => void loadCategory(category)}
          />
        </View>
      )}

      {authorityState === "checking" ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator
            color={theme.state.loading}
            size="large"
            accessibilityLabel={t("home.loadingAuctionsA11y")}
          />
          <Text style={styles.secondaryText}>{t("home.loadingAuctions")}</Text>
        </View>
      ) : authorityState === "unavailable" ? (
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            {t("home.liveUnavailableTitle")}
          </Text>
          <Text style={styles.secondaryText}>
            {error ?? t("common.canonicalUnreachable")}
          </Text>
          <Text style={styles.secondaryText}>
            {t("home.noDemoFallback", { brand: BRAND })}
          </Text>
          <NxsButton label={t("home.retryCanonical")} onPress={retryCanonical} />
        </View>
      ) : (
        <>
          {/* Category Chips Bar */}
          <View style={styles.chipsWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContent}
            >
              <Pressable
                onPress={() => void loadCategory(undefined)}
                accessibilityRole="button"
                accessibilityState={{ selected: !category }}
                accessibilityLabel={t("home.showFeaturedAuctions")}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.chip,
                  !category && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, !category && styles.chipTextActive]}>
                  {t("home.featured")}
                </Text>
              </Pressable>
              {categories.map((item) => {
                const label = localizedCategoryLabel(t, item.slug, item.name);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => void loadCategory(item.slug)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: category === item.slug }}
                    accessibilityLabel={t("home.showCategoryAuctions", {
                      category: label,
                    })}
                    hitSlop={4}
                    style={({ pressed }) => [
                      styles.chip,
                      category === item.slug && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        category === item.slug && styles.chipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {listLoading && (
            <View style={styles.listLoading} accessible accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.state.loading} />
              <Text style={styles.secondaryText}>{t("home.refreshingAuctions")}</Text>
            </View>
          )}

          <FlatList
            data={auctions}
            keyExtractor={(item) => String(item.id)}
            numColumns={2}
            columnWrapperStyle={styles.columnRow}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              !category ? (
                <View style={styles.discoveryHeader}>
                  {/* Contextual Recommendations Module */}
                  {recommendations.items.length > 0 && (
                    <View style={styles.sectionWrap}>
                      <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle} accessibilityRole="header">
                          {t("rec.recommendedLive")}
                        </Text>
                        <Text style={styles.basisBadge}>
                          {recommendations.basis === "history"
                            ? t("rec.basisHistory")
                            : t("rec.basisDiverse")}
                        </Text>
                      </View>
                      <View style={styles.cardsRow}>
                        {recommendations.items.slice(0, 4).map((rec) => (
                          <AuctionCard
                            key={`rec-${rec.item.id}`}
                            item={rec.item}
                            width={grid.cardWidth}
                            now={now}
                            onPress={() => router.push(`/item/${rec.item.id}` as never)}
                          />
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Recently Viewed Module (if history present) */}
                  {recentlyViewedItems.length > 0 && (
                    <View style={styles.sectionWrap}>
                      <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle} accessibilityRole="header">
                          {t("rec.recentlyViewed")}
                        </Text>
                        <Pressable
                          hitSlop={4}
                          onPress={() => void handleClearRecentlyViewed()}
                          accessibilityRole="button"
                          accessibilityLabel={t("rec.clearRecentlyViewedA11y")}
                          style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
                        >
                          <Text style={styles.clearBtnText}>{t("rec.clearRecentlyViewed")}</Text>
                        </Pressable>
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.horizontalScroll}
                      >
                        {recentlyViewedItems.map((item) => (
                          <View key={`viewed-${item.id}`} style={{ width: Math.max(140, grid.cardWidth * 0.85) }}>
                            <AuctionCard
                              item={item}
                              width={Math.max(140, grid.cardWidth * 0.85)}
                              now={now}
                              onPress={() => router.push(`/item/${item.id}` as never)}
                            />
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Ending Soon Module */}
                  {endingSoonList.length > 0 && (
                    <View style={styles.sectionWrap}>
                      <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle} accessibilityRole="header">
                          {t("rec.endingSoon")}
                        </Text>
                      </View>
                      <View style={styles.cardsRow}>
                        {endingSoonList.slice(0, 2).map((item) => (
                          <AuctionCard
                            key={`soon-${item.id}`}
                            item={item}
                            width={grid.cardWidth}
                            now={now}
                            onPress={() => router.push(`/item/${item.id}` as never)}
                          />
                        ))}
                      </View>
                    </View>
                  )}

                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle} accessibilityRole="header">
                      {t("home.featured")}
                    </Text>
                  </View>
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.title} accessibilityRole="header">
                  {t("home.noLiveAuctions")}
                </Text>
                <Text style={styles.secondaryText}>
                  {t("home.tryAnotherCategory")}
                </Text>
                {emptyAction}
              </View>
            }
            renderItem={({ item }) => (
              <AuctionCard
                item={item}
                width={grid.cardWidth}
                now={now}
                onPress={() => router.push(`/item/${item.id}` as never)}
              />
            )}
            ListFooterComponent={
              sold.length > 0 ? (
                <View style={styles.soldSection}>
                  <Text style={styles.soldTitle} accessibilityRole="header">
                    {t("home.recentlySold")}
                  </Text>
                  <View style={styles.soldWrap}>
                    {sold.map((row) => (
                      <AuctionCard
                        key={`sold-${row.id}`}
                        item={row}
                        width={grid.cardWidth}
                        now={now}
                        onPress={() => router.push(`/item/${row.id}` as never)}
                      />
                    ))}
                  </View>
                </View>
              ) : undefined
            }
          />
        </>
      )}
      <BottomNav active="home" />
    </SafeAreaView>
  );
}

function createStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
  containerWidth: number,
  gridGap: number,
) {
  const textAlign = writingDirection === "rtl" ? "right" : "left";
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    authorityRow: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: screenPadding,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.section,
    },
    authorityText: {
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      textAlign,
    },
    warningBox: {
      marginHorizontal: screenPadding,
      marginTop: 12,
      padding: 12,
      gap: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.warning,
      backgroundColor: theme.surface.raised,
    },
    warningText: {
      color: theme.state.warning,
      fontSize: 14,
      lineHeight: 21,
      textAlign,
    },
    errorBox: {
      marginHorizontal: screenPadding,
      marginTop: 12,
      padding: 12,
      gap: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.error,
      backgroundColor: theme.surface.raised,
    },
    errorText: {
      color: theme.state.error,
      fontSize: 14,
      lineHeight: 21,
      textAlign,
    },
    center: {
      flex: 1,
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: Math.max(screenPadding, 24),
    },
    title: {
      color: theme.text.primary,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "800",
      textAlign: "center",
    },
    secondaryText: {
      color: theme.text.secondary,
      fontSize: 16,
      lineHeight: 24,
      textAlign: "center",
    },
    chipsWrap: {
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
    },
    chipsContent: {
      flexDirection: rowDirection,
      gap: 8,
      paddingHorizontal: screenPadding,
      paddingVertical: 8,
    },
    chip: {
      minHeight: 48,
      minWidth: 48,
      justifyContent: "center",
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.raised,
    },
    chipActive: {
      backgroundColor: theme.action.primary,
      borderColor: theme.action.primary,
    },
    chipText: {
      color: theme.text.secondary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      textAlign: "center",
    },
    chipTextActive: { color: theme.text.inverse },
    listLoading: {
      minHeight: 48,
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: screenPadding,
    },
    columnRow: {
      flexDirection: rowDirection,
      gap: gridGap,
    },
    list: {
      width: "100%",
      maxWidth: containerWidth,
      alignSelf: "center",
      flexGrow: 1,
      paddingHorizontal: screenPadding,
      paddingVertical: 12,
    },
    discoveryHeader: {
      marginBottom: 8,
      gap: 12,
    },
    sectionWrap: {
      marginBottom: 8,
    },
    sectionHeader: {
      flexDirection: rowDirection,
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
      minHeight: 32,
    },
    sectionTitle: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    basisBadge: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.action.primary,
      backgroundColor: theme.surface.primaryTint,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: nxsTokens.radius.pill,
    },
    clearBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 8,
    },
    clearBtnText: {
      fontSize: 13,
      color: theme.action.primary,
      fontWeight: "700",
    },
    cardsRow: {
      flexDirection: rowDirection,
      flexWrap: "wrap",
      gap: gridGap,
    },
    horizontalScroll: {
      flexDirection: rowDirection,
      gap: 10,
      paddingVertical: 4,
    },
    emptyState: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingVertical: 32,
    },
    soldSection: {
      paddingTop: 6,
    },
    soldTitle: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.text.primary,
      paddingBottom: 8,
      textAlign,
    },
    soldWrap: {
      flexDirection: rowDirection,
      flexWrap: "wrap",
      gap: gridGap,
    },
    pressed: { opacity: 0.78 },
  });
}
