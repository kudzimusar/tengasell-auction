// Orders tab — honest state: requires a session; order history lands with MOB-04.

import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../auth/session-context";
import { BottomNav } from "../components/BottomNav";
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

export default function OrdersScreen() {
  const router = useRouter();
  const session = useSession();
  const { theme, screenPadding, writingDirection } = useNxs();
  const t = useNxsText();
  const signedIn = session.phase === "authenticated";
  const styles = useMemo(
    () => makeStyles(theme, screenPadding, writingDirection),
    [screenPadding, theme, writingDirection],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t("orders.title")}
        </Text>
      </View>

      <View style={styles.center}>
        <View style={styles.icon}>
          <Text style={styles.iconGlyph}>▤</Text>
        </View>
        <Text style={styles.heading} accessibilityRole="header">
          {signedIn ? t("orders.emptyTitle") : t("orders.signedOutTitle")}
        </Text>
        <Text style={styles.body}>
          {signedIn ? t("orders.emptyBody") : t("orders.signedOutBody")}
        </Text>
        {!signedIn && (
          <NxsButton
            label={t("orders.signIn")}
            accessibilityLabel={t("orders.signInA11y")}
            onPress={() => router.push("/auth/login" as never)}
          />
        )}
      </View>
      <BottomNav active="orders" />
    </SafeAreaView>
  );
}

function makeStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
) {
  const textAlign = writingDirection === "rtl" ? "right" : "left";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    header: {
      minHeight: nxsTokens.touch.minimum,
      paddingHorizontal: screenPadding,
      paddingVertical: 12,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
      justifyContent: "center",
    },
    title: { fontSize: 18, lineHeight: 24, fontWeight: "800", color: theme.text.primary, textAlign },
    center: {
      flex: 1,
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
      padding: Math.max(screenPadding, 24),
      gap: 12,
    },
    icon: {
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: theme.surface.primaryTint,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    iconGlyph: { fontSize: 24, color: theme.action.primary },
    heading: { fontSize: 18, lineHeight: 24, fontWeight: "800", color: theme.text.primary, textAlign: "center" },
    body: { fontSize: 15, color: theme.text.secondary, textAlign: "center", lineHeight: 22 },
  });
}
