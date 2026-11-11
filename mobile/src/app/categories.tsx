// Categories tab — 3-column grid of marketplace categories built on NXS tokens.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../components/BottomNav";
import { ListingGrid } from "../components/ListingGrid";
import { computeGridMetrics } from "../lib/grid-layout";
import { createRequestGuard } from "../lib/request-guard";
import { fetchAuctions, fetchCategories } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

export default function CategoriesScreen() {
  const { width } = useWindowDimensions();
  const { theme, screenPadding, safeArea, writingDirection } = useNxs();
  const t = useNxsText();

  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Category | null>(null);
  const [items, setItems] = useState<AuctionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const categoriesGuard = useRef(createRequestGuard()).current;
  const categoryRequestGuard = useRef(createRequestGuard()).current;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const loadCategories = useCallback(async () => {
    const req = categoriesGuard.next();
    setLoading(true);
    setError(null);
    try {
      const next = await fetchCategories();
      if (!categoriesGuard.isCurrent(req)) return;
      setCategories(next);
    } catch {
      if (!categoriesGuard.isCurrent(req)) return;
      setError(t("categories.loadError"));
    } finally {
      if (categoriesGuard.isCurrent(req)) setLoading(false);
    }
  }, [categoriesGuard, t]);

  useEffect(() => {
    const task = setTimeout(() => {
      void loadCategories();
    }, 0);
    return () => clearTimeout(task);
  }, [loadCategories]);

  const loadCategory = useCallback(
    async (c: Category) => {
      const req = categoryRequestGuard.next();
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchAuctions({ category: c.slug, limit: 40 });
        if (!categoryRequestGuard.isCurrent(req)) return;
        setItems(rows.map(toAuctionView));
      } catch {
        if (!categoryRequestGuard.isCurrent(req)) return;
        // Never leave another category's listings visible under a failure message.
        setItems([]);
        setError(t("categories.categoryError"));
      } finally {
        if (categoryRequestGuard.isCurrent(req)) setLoading(false);
      }
    },
    [categoryRequestGuard, t],
  );

  const open = useCallback(
    (c: Category) => {
      setSelected(c);
      void loadCategory(c);
    },
    [loadCategory],
  );

  const grid = useMemo(
    () =>
      computeGridMetrics({
        viewportWidth: width,
        columns: 3,
        padding: screenPadding,
        safeLeft: safeArea.left,
        safeRight: safeArea.right,
      }),
    [safeArea.left, safeArea.right, screenPadding, width],
  );
  const styles = useMemo(
    () => makeStyles(theme, screenPadding, writingDirection, grid.containerWidth, grid.cardWidth, grid.gap),
    [grid.cardWidth, grid.containerWidth, grid.gap, screenPadding, theme, writingDirection],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {selected ? selected.name : t("categories.title")}
        </Text>
        {selected && (
          <Pressable
            hitSlop={4}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            onPress={() => {
              categoryRequestGuard.invalidate();
              setSelected(null);
              setItems([]);
              setError(null);
              setLoading(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("categories.showAllA11y")}
          >
            <Text style={styles.back}>{t("categories.all")}</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} accessibilityLabel={t("categories.loadingA11y")} />
        </View>
      ) : error && !selected ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle} accessibilityRole="alert">
            {error}
          </Text>
          <NxsButton
            label={t("common.tryAgain")}
            variant="secondary"
            onPress={() => void loadCategories()}
          />
        </View>
      ) : selected && error ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle} accessibilityRole="alert">
            {error}
          </Text>
          <NxsButton
            label={t("common.tryAgain")}
            variant="secondary"
            onPress={() => {
              if (selected) void loadCategory(selected);
            }}
          />
        </View>
      ) : selected ? (
        <ListingGrid items={items} now={now} empty={t("categories.empty")} />
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {categories.map((c) => (
            <Pressable
              hitSlop={4}
              key={c.id}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              onPress={() => open(c)}
              accessibilityRole="button"
              accessibilityLabel={t("categories.openCategoryA11y", { category: c.name })}
            >
              <View style={styles.tileIcon}>
                <Text style={styles.tileLetter}>{c.name.slice(0, 1)}</Text>
              </View>
              <Text style={styles.tileLabel} numberOfLines={2}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <BottomNav active="categories" />
    </SafeAreaView>
  );
}

function makeStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
  containerWidth: number,
  tileWidth: number,
  gap: number,
) {
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";
  const textAlign = writingDirection === "rtl" ? "right" : "left";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    header: {
      minHeight: 56,
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: screenPadding,
      paddingVertical: 8,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    title: {
      fontSize: 18,
      lineHeight: 24,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    backBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      paddingHorizontal: 12,
      justifyContent: "center",
      alignItems: "center",
    },
    back: { fontSize: 14, fontWeight: "700", color: theme.action.primary },
    pressed: { opacity: 0.8 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    errorTitle: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.text.secondary,
      textAlign: "center",
    },
    grid: {
      width: "100%",
      maxWidth: containerWidth,
      alignSelf: "center",
      flexDirection: rowDirection,
      flexWrap: "wrap",
      paddingHorizontal: screenPadding,
      paddingVertical: 12,
      gap,
    },
    tile: {
      width: tileWidth,
      minHeight: 88,
      minWidth: nxsTokens.touch.minimum,
      backgroundColor: theme.surface.raised,
      borderRadius: nxsTokens.radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    tileIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: theme.surface.primaryTint,
      alignItems: "center",
      justifyContent: "center",
    },
    tileLetter: { fontSize: 20, fontWeight: "900", color: theme.action.primary },
    tileLabel: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
      color: theme.text.primary,
      paddingHorizontal: 6,
    },
  });
}
