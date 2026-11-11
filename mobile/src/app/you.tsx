// You tab — embeds AccountContent without redirecting when signed out or double-padding bottom inset.

import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { AccountContent } from "../components/AccountContent";
import { BottomNav } from "../components/BottomNav";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";

export default function YouScreen() {
  const { theme } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => StyleSheet.create({ wrap: { flex: 1, backgroundColor: theme.surface.canvas } }),
    [theme.surface.canvas],
  );

  return (
    <View style={styles.wrap} accessibilityLabel={t("nav.you")}>
      <AccountContent embeddedTab />
      <BottomNav active="you" />
    </View>
  );
}
