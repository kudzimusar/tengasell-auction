// MOB-02 — Compact auction-first top header built around Search.
// Replaces prominent wordmark logo with a wide search trigger, notifications
// affordance, and account/sign-in avatar.

import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "../auth/session-context";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

interface Props {
  initialQuery?: string;
  onSearchPress?: () => void;
  editable?: boolean;
}

export function SearchHeader({ initialQuery, onSearchPress }: Props) {
  const router = useRouter();
  const session = useSession();
  const { theme, screenPadding, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => makeStyles(theme, screenPadding, writingDirection),
    [screenPadding, theme, writingDirection],
  );

  const handleSearchTap = () => {
    if (onSearchPress) {
      onSearchPress();
    } else {
      router.push("/search" as never);
    }
  };

  const handleAccountTap = () => {
    if (session.phase === "authenticated") {
      router.push("/account" as never);
    } else {
      router.push("/auth/login" as never);
    }
  };

  const authenticated = session.phase === "authenticated";
  const userInitial =
    (session.identity?.id ? session.identity.id.slice(0, 1) : "") || "U";

  return (
    <View style={styles.header}>
      {/* Wide Search Field Trigger */}
      <Pressable
        hitSlop={4}
        style={({ pressed }) => [styles.searchTrigger, pressed && styles.pressed]}
        onPress={handleSearchTap}
        accessibilityRole="search"
        accessibilityLabel={t("header.searchA11y")}
      >
        <View style={styles.searchIcon}>
          <View style={styles.glassCircle} />
          <View style={styles.glassHandle} />
        </View>
        <Text style={styles.searchPlaceholder} numberOfLines={1}>
          {initialQuery || t("header.searchPlaceholder")}
        </Text>
      </Pressable>

      {/* Notifications Affordance */}
      <Pressable
        hitSlop={4}
        style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        onPress={() => router.push(authenticated ? ("/you" as never) : ("/auth/login" as never))}
        accessibilityRole="button"
        accessibilityLabel={t("header.notificationsA11y")}
      >
        <View style={styles.bellIcon}>
          <View style={styles.bellDome} />
          <View style={styles.bellClapper} />
        </View>
      </Pressable>

      {/* Account / Sign-In Avatar */}
      <Pressable
        hitSlop={4}
        style={({ pressed }) => [styles.accountButton, pressed && styles.pressed]}
        onPress={handleAccountTap}
        accessibilityRole="button"
        accessibilityLabel={t("header.accountA11y")}
      >
        {authenticated ? (
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{userInitial.toUpperCase()}</Text>
          </View>
        ) : (
          <Text style={styles.signInText}>{t("header.signIn")}</Text>
        )}
      </Pressable>
    </View>
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
    header: {
      minHeight: 56,
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 8,
      paddingHorizontal: screenPadding,
      paddingVertical: 6,
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.subtle,
    },
    searchTrigger: {
      flex: 1,
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.surface.raised,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1.5,
      borderColor: theme.action.primary,
      paddingHorizontal: 12,
    },
    searchIcon: {
      width: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    glassCircle: {
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.action.primary,
    },
    glassHandle: {
      position: "absolute",
      right: 1,
      bottom: 1,
      width: 6,
      height: 2,
      backgroundColor: theme.action.primary,
      transform: [{ rotate: "45deg" }],
    },
    searchPlaceholder: {
      flex: 1,
      fontSize: 13,
      color: theme.text.secondary,
      textAlign,
    },
    actionButton: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    bellIcon: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    bellDome: {
      width: 12,
      height: 10,
      borderTopLeftRadius: 6,
      borderTopRightRadius: 6,
      borderWidth: 2,
      borderColor: theme.action.primary,
    },
    bellClapper: {
      width: 14,
      height: 2,
      backgroundColor: theme.action.primary,
      borderRadius: 1,
      marginTop: 1,
    },
    accountButton: {
      minHeight: nxsTokens.touch.minimum,
      minWidth: nxsTokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    avatarCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.action.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      color: theme.text.inverse,
      fontWeight: "800",
      fontSize: 13,
    },
    signInText: {
      color: theme.action.primary,
      fontWeight: "700",
      fontSize: 13,
      textAlign: "center",
    },
    pressed: {
      opacity: 0.78,
    },
  });
}
