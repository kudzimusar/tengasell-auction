// Search screen — title search, history, suggestions and contextual discovery.

import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../auth/session-context";
import { BottomNav } from "../components/BottomNav";
import { ListingGrid } from "../components/ListingGrid";
import { localizedCategoryLabel } from "../lib/format";
import {
  rankSearchResults,
  suggestQueries,
  type QuerySuggestion,
  type SearchSort,
} from "../lib/recommend";
import { createRequestGuard } from "../lib/request-guard";
import { fetchAuctions, fetchCategories } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";
import {
  addSearchQuery,
  clearSearchHistory,
  getSearchHistory,
  removeSearchQuery,
} from "../lib/user-store";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

export default function SearchScreen() {
  const router = useRouter();
  const session = useSession();
  const { theme, screenPadding, writingDirection } = useNxs();
  const t = useNxsText();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AuctionView[]>([]);
  const [rawAuctions, setRawAuctions] = useState<AuctionView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const requestGuard = useRef(createRequestGuard()).current;
  const [categoriesGuard] = useState(() => createRequestGuard());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const refreshHistory = useCallback(async () => {
    const h = await getSearchHistory(session.identity?.id ?? null);
    setHistory(h);
  }, [session.identity?.id]);

  useEffect(() => {
    const task = setTimeout(() => {
      void refreshHistory();
    }, 0);
    return () => clearTimeout(task);
  }, [refreshHistory]);

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

  // Load an initial pool of titles for live suggestions
  useEffect(() => {
    fetchAuctions({ limit: 50 })
      .then((rows) => setRawAuctions(rows.map(toAuctionView)))
      .catch(() => undefined);
  }, []);

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
        const parsed = rows.map(toAuctionView);
        const sorted = rankSearchResults(term, parsed, sort, Date.now());
        setItems(sorted);
        setError(null);
        setSearched(true);
        void addSearchQuery(term, session.identity?.id ?? null).then((h) => setHistory(h));
      } catch {
        if (!requestGuard.isCurrent(request)) return;
        setItems([]);
        setSearched(true);
        setError(t("search.unavailableError"));
      } finally {
        if (requestGuard.isCurrent(request)) setBusy(false);
      }
    },
    [requestGuard, session.identity, sort, t],
  );

  const handleClearHistory = async () => {
    await clearSearchHistory(session.identity?.id ?? null);
    setHistory([]);
  };

  const handleRemoveHistoryItem = async (phrase: string) => {
    const updated = await removeSearchQuery(phrase, session.identity?.id ?? null);
    setHistory(updated);
  };

  const suggestions: QuerySuggestion[] = useMemo(() => {
    if (!query.trim() || searched) return [];
    return suggestQueries(query, {
      history,
      categories: categories.map((c) => ({ slug: c.slug, label: c.name })),
      titles: rawAuctions.map((a) => a.title),
    });
  }, [categories, history, query, rawAuctions, searched]);

  const styles = useMemo(
    () => makeStyles(theme, screenPadding, writingDirection),
    [screenPadding, theme, writingDirection],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* Top Search & Navigation Bar */}
      <View style={styles.searchBar}>
        <Pressable
          hitSlop={4}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("item.backA11y")}
        >
          <Text style={styles.backGlyph}>{writingDirection === "rtl" ? "›" : "‹"}</Text>
        </Pressable>

        <View style={styles.inputWrap}>
          <TextInput
            value={query}
            onChangeText={(txt) => {
              setQuery(txt);
              if (searched && !txt.trim()) {
                setSearched(false);
                setItems([]);
              }
            }}
            placeholder={t("search.placeholder")}
            placeholderTextColor={theme.text.secondary}
            returnKeyType="search"
            onSubmitEditing={() => void run(query)}
            style={styles.input}
            accessibilityLabel={t("search.inputA11y")}
            autoFocus
          />
          {query.length > 0 && (
            <Pressable
              hitSlop={4}
              onPress={() => {
                setQuery("");
                setSearched(false);
                setItems([]);
                setError(null);
              }}
              style={({ pressed }) => [styles.clearInputBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t("search.clearSearchA11y")}
            >
              <Text style={styles.clearInputGlyph}>✕</Text>
            </Pressable>
          )}
        </View>

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

      {/* Live Suggestions Dropdown (while typing before submit) */}
      {!searched && suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestTitle} accessibilityRole="header">
            {t("search.suggestionsTitle")}
          </Text>
          {suggestions.map((sug, idx) => (
            <Pressable
              key={`${sug.text}-${idx}`}
              hitSlop={4}
              style={({ pressed }) => [styles.suggestionRow, pressed && styles.pressed]}
              onPress={() => {
                setQuery(sug.text);
                void run(sug.text);
              }}
              accessibilityRole="button"
              accessibilityLabel={sug.text}
            >
              <Text style={styles.suggestionText}>{sug.text}</Text>
              <Text style={styles.suggestionTag}>{sug.source}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Discovery Area: Recent Searches & Category Chips (when not searched) */}
      {!searched && suggestions.length === 0 && (
        <ScrollView contentContainerStyle={styles.discoveryScroll}>
          {history.length > 0 && (
            <View style={styles.historySection}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle} accessibilityRole="header">
                  {t("search.recentTitle")}
                </Text>
                <Pressable
                  hitSlop={4}
                  onPress={() => void handleClearHistory()}
                  accessibilityRole="button"
                  accessibilityLabel={t("search.clearHistoryA11y")}
                  style={({ pressed }) => [styles.clearHistoryBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.clearHistoryText}>{t("search.clearHistory")}</Text>
                </Pressable>
              </View>

              <View style={styles.historyChips}>
                {history.map((phrase) => (
                  <View key={phrase} style={styles.historyChipWrap}>
                    <Pressable
                      hitSlop={4}
                      style={({ pressed }) => [styles.historyChipBtn, pressed && styles.pressed]}
                      onPress={() => {
                        setQuery(phrase);
                        void run(phrase);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={phrase}
                    >
                      <Text style={styles.historyChipText} numberOfLines={1}>
                        {phrase}
                      </Text>
                    </Pressable>
                    <Pressable
                      hitSlop={4}
                      style={({ pressed }) => [styles.historyChipDelete, pressed && styles.pressed]}
                      onPress={() => void handleRemoveHistoryItem(phrase)}
                      accessibilityRole="button"
                      accessibilityLabel={t("search.deleteQueryA11y", { query: phrase })}
                    >
                      <Text style={styles.historyDeleteText}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.suggestWrap}>
            <Text style={styles.suggestTitle} accessibilityRole="header">
              {t("search.browseCategoryTitle")}
            </Text>
            <View style={styles.chips}>
              {categories.slice(0, 8).map((c) => {
                const label = localizedCategoryLabel(t, c.slug, c.name);
                return (
                  <Pressable
                    hitSlop={4}
                    key={c.id}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    onPress={() => {
                      setQuery(c.name);
                      void run(c.name);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("search.chipA11y", { category: label })}
                  >
                    <Text style={styles.chipText}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Search Sort Bar (when results shown) */}
      {searched && items.length > 0 && (
        <View style={styles.sortBar}>
          {(["relevance", "ending", "price_asc", "bids"] as SearchSort[]).map((mode) => {
            const on = sort === mode;
            const label =
              mode === "relevance"
                ? t("search.sortRelevance")
                : mode === "ending"
                  ? t("search.sortEnding")
                  : mode === "price_asc"
                    ? t("search.sortPrice")
                    : t("search.sortBids");
            return (
              <Pressable
                key={mode}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.sortBtn,
                  on && styles.sortBtnActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  setSort(mode);
                  setItems(rankSearchResults(query, items, mode, now));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t("search.sortA11y", { sort: label })}
              >
                <Text style={[styles.sortBtnText, on && styles.sortBtnTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Results Grid / Loading State */}
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
      <BottomNav />
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
      gap: 6,
      paddingHorizontal: screenPadding,
      paddingVertical: 8,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    backBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
    },
    backGlyph: {
      fontSize: 26,
      color: theme.action.primary,
      lineHeight: 28,
    },
    inputWrap: {
      flex: 1,
      minHeight: nxsTokens.touch.minimum,
      flexDirection: rowDirection,
      alignItems: "center",
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1.5,
      borderColor: theme.action.primary,
      backgroundColor: theme.surface.raised,
      paddingHorizontal: 12,
    },
    input: {
      flex: 1,
      minHeight: nxsTokens.touch.minimum,
      fontSize: 14,
      color: theme.text.primary,
      textAlign,
    },
    clearInputBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
    },
    clearInputGlyph: {
      fontSize: 14,
      color: theme.text.secondary,
    },
    go: {
      backgroundColor: theme.action.primary,
      paddingHorizontal: 14,
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      borderRadius: nxsTokens.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    goText: { color: theme.text.inverse, fontWeight: "800", fontSize: 13 },
    pressed: { opacity: 0.8 },
    discoveryScroll: {
      paddingBottom: 24,
    },
    historySection: {
      paddingHorizontal: screenPadding,
      paddingTop: 12,
      paddingBottom: 8,
      gap: 8,
    },
    historyHeader: {
      flexDirection: rowDirection,
      justifyContent: "space-between",
      alignItems: "center",
      minHeight: 32,
    },
    historyTitle: {
      fontSize: 13,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    clearHistoryBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 6,
    },
    clearHistoryText: {
      fontSize: 12,
      color: theme.action.primary,
      fontWeight: "700",
    },
    historyChips: {
      flexDirection: rowDirection,
      flexWrap: "wrap",
      gap: 8,
    },
    historyChipWrap: {
      flexDirection: rowDirection,
      alignItems: "center",
      borderRadius: nxsTokens.radius.pill,
      backgroundColor: theme.surface.raised,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      overflow: "hidden",
    },
    historyChipBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    historyChipText: {
      fontSize: 13,
      color: theme.text.primary,
      fontWeight: "600",
      maxWidth: 160,
    },
    historyChipDelete: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 8,
    },
    historyDeleteText: {
      fontSize: 12,
      color: theme.text.secondary,
      fontWeight: "700",
    },
    suggestionsContainer: {
      paddingHorizontal: screenPadding,
      paddingVertical: 8,
      backgroundColor: theme.surface.raised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    suggestionRow: {
      minHeight: nxsTokens.touch.minimum,
      flexDirection: rowDirection,
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
      paddingVertical: 6,
    },
    suggestionText: {
      fontSize: 14,
      color: theme.text.primary,
      fontWeight: "600",
      textAlign,
    },
    suggestionTag: {
      fontSize: 11,
      color: theme.text.secondary,
      backgroundColor: theme.surface.overlay,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
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
    sortBar: {
      flexDirection: rowDirection,
      gap: 6,
      paddingHorizontal: screenPadding,
      paddingVertical: 6,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    sortBtn: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      paddingHorizontal: 10,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.raised,
      justifyContent: "center",
      alignItems: "center",
    },
    sortBtnActive: {
      backgroundColor: theme.action.primary,
      borderColor: theme.action.primary,
    },
    sortBtnText: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text.secondary,
    },
    sortBtnTextActive: {
      color: theme.text.inverse,
      fontWeight: "700",
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
  });
}
