// Five-item bottom navigation, modelled on the requested reference layout:
// Home · Categories · Search · Orders · You.
// Icons are drawn with primitives so no icon package is required.

import { usePathname, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { NxsStringKey } from "../nxs/localization/catalog";
import { useNxsText } from "../nxs/localization/useNxsText";
import { useNxs } from "../nxs/context/NxsProvider";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

type TabKey = "home" | "categories" | "search" | "orders" | "you";

const TABS: { key: TabKey; labelKey: NxsStringKey; route: string }[] = [
  { key: "home", labelKey: "nav.home", route: "/" },
  { key: "categories", labelKey: "nav.categories", route: "/categories" },
  { key: "search", labelKey: "nav.search", route: "/search" },
  { key: "orders", labelKey: "nav.orders", route: "/orders" },
  { key: "you", labelKey: "nav.you", route: "/you" },
];

export function BottomNav({ active }: { active?: TabKey } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, safeArea, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => makeStyles(theme, safeArea.bottom, writingDirection),
    [theme, safeArea.bottom, writingDirection],
  );

  const current: TabKey | null =
    active ??
    (pathname.startsWith("/item/")
      ? null
      : pathname === "/categories"
        ? "categories"
        : pathname === "/search"
          ? "search"
          : pathname === "/orders"
            ? "orders"
            : pathname === "/you"
              ? "you"
              : "home");

  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const on = tab.key === current;
        const color = on ? theme.action.primary : theme.text.secondary;
        const label = t(tab.labelKey);
        return (
          <Pressable
            hitSlop={4}
            key={tab.key}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            onPress={() => router.push(tab.route as never)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
          >
            <View style={styles.iconWrap}>
              <Glyph name={tab.key} color={color} />
            </View>
            <Text
              style={[styles.label, { color }, on && styles.labelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Glyph({ name, color }: { name: TabKey; color: string }) {
  const s = { borderColor: color } as const;
  switch (name) {
    case "home":
      return (
        <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "flex-end" }}>
          <View
            style={{
              width: 11,
              height: 11,
              borderTopWidth: 2,
              borderLeftWidth: 2,
              ...s,
              transform: [{ rotate: "45deg" }],
              marginBottom: -5,
            }}
          />
          <View style={{ width: 15, height: 10, borderWidth: 2, borderRadius: 3, ...s }} />
        </View>
      );
    case "categories":
      return (
        <View style={{ width: 20, height: 20, flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: 8, height: 8, borderWidth: 2, borderRadius: 2, ...s }} />
          ))}
        </View>
      );
    case "search":
      return (
        <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, ...s }} />
          <View
            style={{
              position: "absolute",
              right: 2,
              bottom: 2,
              width: 7,
              height: 2,
              backgroundColor: color,
              transform: [{ rotate: "45deg" }],
            }}
          />
        </View>
      );
    case "orders":
      return (
        <View style={{ width: 20, height: 20, justifyContent: "center", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 2, width: i === 2 ? 10 : 16, backgroundColor: color, borderRadius: 1 }} />
          ))}
        </View>
      );
    case "you":
      return (
        <View style={{ width: 20, height: 20, alignItems: "center" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, ...s, marginTop: 1 }} />
          <View style={{ width: 15, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderWidth: 2, ...s, marginTop: 2 }} />
        </View>
      );
  }
}

function makeStyles(theme: NxsTheme, bottomInset: number, writingDirection: "ltr" | "rtl") {
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";
  return StyleSheet.create({
    bar: {
      flexDirection: rowDirection,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
      backgroundColor: theme.surface.section,
      paddingTop: 6,
      paddingBottom: Math.max(bottomInset, 6),
    },
    item: {
      flex: 1,
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      paddingHorizontal: 2,
      paddingVertical: 4,
    },
    pressed: { opacity: 0.78 },
    iconWrap: { height: 22, alignItems: "center", justifyContent: "center" },
    label: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
    labelActive: { fontWeight: "800" },
  });
}
