// MOB-02 / MOB-03 — Live Auctions destination.
// Queries genuine canonical auction data via TrailBase authority.
// Exposes live bidding filters: All Live, Ending Soon, Most Active, Recently Started,
// and Category chips. Only biddable live auctions appear as open for bidding.

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

import { AuctionCard } from "../components/AuctionCard";
import { BottomNav } from "../components/BottomNav";
import { SearchHeader } from "../components/SearchHeader";
import { localizedCategoryLabel } from "../lib/format";
import { computeGridMetrics } from "../lib/grid-layout";
import {
  endingSoon,
  filterEligible,
  mostActive,
  recentlyStarted,
} from "../lib/recommend";
import { createRequestGuard } from "../lib/request-guard";
import { fetchAuctions, fetchCategories, probeCanonical } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { localizeKnownRuntimeMessage } from "../nxs/localization/runtimeMessages";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

type LiveFilter = "all" | "ending" | "active" | "recent";

export default function LiveAuctionsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { theme, screenPadding, safeArea, writingDirection } = useNxs();
  const t = useNxsText();

  const [rawAuctions, setRawAuctions] = useState<AuctionView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeFilter, setActiveFilter] = useState<LiveFilter>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const requestGuard = useRef(createRequestGuard()).current;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const loadData = useCallback(async () => {
    const req = requestGuard.next();
    setLoading(true);
    setError(null);
    try {
      await probeCanonical();
      const [cats, auctions] = await Promise.all([
        fetchCategories(),
        fetchAuctions({ status: "live", limit: 60 }),
      ]);
      if (!requestGuard.isCurrent(req)) return;
      setCategories(cats);
      setRawAuctions(auctions.map(toAuctionView));
    } catch (e) {
      if (!requestGuard.isCurrent(req)) return;
      setRawAuctions([]);
      setError(
        e instanceof Error
          ? localizeKnownRuntimeMessage(e.message, t, "common.canonicalUnreachable")
          : t("common.canonicalUnreachable"),
      );
    } finally {
      if (requestGuard.isCurrent(req)) setLoading(false);
    }
  }, [requestGuard, t]);

  useEffect(() => {
    const task = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(task);
  }, [loadData]);

  // Derived filtered & sorted items
  const displayItems = useMemo(() => {
    let pool = filterEligible(rawAuctions, { now, liveOnly: true });
    if (selectedCategory) {
      pool = pool.filter((it) => it.category === selectedCategory);
    }

    switch (activeFilter) {
      case "ending":
        return endingSoon(pool, { now, limit: 60 });
      case "active":
        return mostActive(pool, { now, limit: 60 });
      case "recent":
        return recentlyStarted(pool, { now, limit: 60 });
      case "all":
      default:
        return pool;
    }
  }, [activeFilter, now, rawAuctions, selectedCategory]);

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
    () =>
      makeStyles(
        theme,
        screenPadding,
        writingDirection,
        grid.containerWidth,
        grid.gap,
      ),
    [grid.containerWidth, grid.gap, screenPadding, theme, writingDirection],
  );

  const filterTabs: { key: LiveFilter; label: string }[] = [
    { key: "all", label: t("live.allLive") },
    { key: "ending", label: t("live.endingSoon") },
    { key: "active", label: t("live.mostActive") },
    { key: "recent", label: t("live.recentlyStarted") },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <SearchHeader />

      {/* Filter Tabs Bar */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          {filterTabs.map((tab) => {
            const on = activeFilter === tab.key;
            return (
              <Pressable
                key={tab.key}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.filterTab,
                  on && styles.filterTabActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setActiveFilter(tab.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t("live.filterA11y", { filter: tab.label })}
              >
                <Text
                  style={[styles.filterTabText, on && styles.filterTabTextActive]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Category Chips Bar */}
      {categories.length > 0 && (
        <View style={styles.categoryChipsBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryChipsContent}
          >
            <Pressable
              hitSlop={4}
              style={({ pressed }) => [
                styles.categoryChip,
                !selectedCategory && styles.categoryChipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => setSelectedCategory(null)}
              accessibilityRole="button"
              accessibilityState={{ selected: !selectedCategory }}
              accessibilityLabel={t("categories.all")}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  !selectedCategory && styles.categoryChipTextActive,
                ]}
              >
                {t("categories.all")}
              </Text>
            </Pressable>
            {categories.map((c) => {
              const on = selectedCategory === c.slug;
              const label = localizedCategoryLabel(t, c.slug, c.name);
              return (
                <Pressable
                  key={c.id}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.categoryChip,
                    on && styles.categoryChipActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setSelectedCategory(on ? null : c.slug)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t("live.categoryFilter", { category: label })}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      on && styles.categoryChipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator
            color={theme.state.loading}
            size="large"
            accessibilityLabel={t("live.loadingA11y")}
          />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
          <NxsButton
            label={t("live.refresh")}
            variant="secondary"
            onPress={() => void loadData()}
          />
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={styles.columnRow}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle} accessibilityRole="header">
                {t("live.emptyTitle")}
              </Text>
              <Text style={styles.emptySubtitle}>
                {t("live.emptySubtitle")}
              </Text>
              <NxsButton
                label={t("live.refresh")}
                variant="secondary"
                onPress={() => void loadData()}
              />
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
        />
      )}

      <BottomNav active="live" />
    </SafeAreaView>
  );
}

function makeStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
  containerWidth: number,
  gridGap: number,
) {
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";
  const textAlign = writingDirection === "rtl" ? "right" : "left";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    filterBar: {
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    filterContent: {
      flexDirection: rowDirection,
      gap: 6,
      paddingHorizontal: screenPadding,
      paddingVertical: 6,
    },
    filterTab: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      paddingHorizontal: 12,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: nxsTokens.radius.pill,
      backgroundColor: theme.surface.raised,
      borderWidth: 1,
      borderColor: theme.border.subtle,
    },
    filterTabActive: {
      backgroundColor: theme.action.primary,
      borderColor: theme.action.primary,
    },
    filterTabText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.text.secondary,
      textAlign: "center",
    },
    filterTabTextActive: {
      color: theme.text.inverse,
    },
    categoryChipsBar: {
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    categoryChipsContent: {
      flexDirection: rowDirection,
      gap: 6,
      paddingHorizontal: screenPadding,
      paddingVertical: 6,
    },
    categoryChip: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      paddingHorizontal: 12,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.raised,
      justifyContent: "center",
      alignItems: "center",
    },
    categoryChipActive: {
      backgroundColor: theme.surface.primaryTint,
      borderColor: theme.action.primary,
    },
    categoryChipText: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text.secondary,
      textAlign: "center",
    },
    categoryChipTextActive: {
      color: theme.action.primary,
      fontWeight: "700",
    },
    pressed: { opacity: 0.78 },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 12,
    },
    errorText: {
      color: theme.state.error,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
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
    empty: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      gap: 12,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    emptySubtitle: {
      fontSize: 14,
      color: theme.text.secondary,
      textAlign: "center",
      paddingHorizontal: 20,
    },
  });
}
