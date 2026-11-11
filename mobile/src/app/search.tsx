// Search tab — title search across currently live auctions via canonical API.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../components/BottomNav";
import { ListingGrid } from "../components/ListingGrid";
import { createRequestGuard } from "../lib/request-guard";
import { fetchAuctions, fetchCategories } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

export default function SearchScreen() {
  const { theme, screenPadding, writingDirection } = useNxs();
  const t = useNxsText();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AuctionView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const requestGuard = useRef(createRequestGuard()).current;
  const [categoriesGuard] = useState(() => createRequestGuard());

  useEffect(() => {
    const req = categoriesGuard.next();
    fetchCategories()
      .then((rows) => {
        if (categoriesGuard.isCurrent(req)) setCategories(rows);
      })
      .catch(() => undefined);
    return () => {
      categoriesGuard.invalidate();
    };
  }, [categoriesGuard]);

  const run = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (!term) {
        requestGuard.invalidate();
        setBusy(false);
        setItems([]);
        setError(null);
        setSearched(false);
        return;
      }
      const request = requestGuard.next();
      setBusy(true);
      setError(null);
      try {
        const rows = await fetchAuctions({ search: term, limit: 40 });
        if (!requestGuard.isCurrent(request)) return;
        setItems(rows.map(toAuctionView));
        setError(null);
        setSearched(true);
      } catch {
        if (!requestGuard.isCurrent(request)) return;
        // Never leave the previous query's rows under a failure message.
        setItems([]);
        setSearched(true);
        setError(t("search.unavailableError"));
      } finally {
        if (requestGuard.isCurrent(request)) setBusy(false);
      }
    },
    [requestGuard, t],
  );

  const styles = useMemo(
    () => makeStyles(theme, screenPadding, writingDirection),
    [screenPadding, theme, writingDirection],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.searchBar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("search.placeholder")}
          placeholderTextColor={theme.text.secondary}
          returnKeyType="search"
          onSubmitEditing={() => void run(query)}
          style={styles.input}
          accessibilityLabel={t("search.inputA11y")}
        />
        <Pressable
          hitSlop={4}
          style={({ pressed }) => [styles.go, pressed && styles.pressed]}
          onPress={() => void run(query)}
          accessibilityRole="button"
          accessibilityLabel={t("search.submit")}
        >
          <Text style={styles.goText}>{t("search.submit")}</Text>
        </Pressable>
      </View>

      {!searched && (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestTitle} accessibilityRole="header">
            {t("search.browseCategoryTitle")}
          </Text>
          <View style={styles.chips}>
            {categories.slice(0, 8).map((c) => (
              <Pressable
                hitSlop={4}
                key={c.id}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                onPress={() => {
                  setQuery(c.name);
                  void run(c.name);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("search.chipA11y", { category: c.name })}
              >
                <Text style={styles.chipText}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {busy ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} accessibilityLabel={t("search.loadingA11y")} />
        </View>
      ) : (
        <ListingGrid
          items={items}
          now={now}
          empty={
            searched
              ? (error ?? t("search.emptyNoResults"))
              : t("search.promptLiveOnly")
          }
        />
      )}
      <BottomNav active="search" />
    </SafeAreaView>
  );
}

function makeStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
) {
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";
  const textAlign = writingDirection === "rtl" ? "right" : "left";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    searchBar: {
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 8,
      paddingHorizontal: screenPadding,
      paddingVertical: 10,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    input: {
      flex: 1,
      minHeight: nxsTokens.touch.minimum,
      borderRadius: nxsTokens.radius.expressive,
      borderWidth: 1.5,
      borderColor: theme.action.primary,
      paddingHorizontal: 14,
      fontSize: 14,
      color: theme.text.primary,
      backgroundColor: theme.surface.raised,
      textAlign,
    },
    go: {
      backgroundColor: theme.action.primary,
      paddingHorizontal: 16,
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      borderRadius: nxsTokens.radius.expressive,
      alignItems: "center",
      justifyContent: "center",
    },
    goText: { color: theme.text.inverse, fontWeight: "800", fontSize: 14 },
    pressed: { opacity: 0.8 },
    suggestWrap: {
      width: "100%",
      maxWidth: 920,
      alignSelf: "center",
      paddingHorizontal: screenPadding,
      paddingVertical: 14,
      gap: 10,
    },
    suggestTitle: {
      fontSize: 13,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    chips: { flexDirection: rowDirection, flexWrap: "wrap", gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.raised,
      borderRadius: nxsTokens.radius.pill,
      paddingHorizontal: 14,
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
    },
    chipText: { fontSize: 13, color: theme.text.primary, fontWeight: "600" },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
  });
}
