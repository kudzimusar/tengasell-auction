import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BUILD_PROVENANCE } from "../lib/build-info";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

export function AboutDiagnosticsCard() {
  const { theme, writingDirection } = useNxs();
  const t = useNxsText();
  const [expanded, setExpanded] = useState(true);
  const styles = createStyles(theme, writingDirection);

  const shortSha = BUILD_PROVENANCE.commitSha.slice(0, 10);
  const isPort8080 = BUILD_PROVENANCE.isPort8080Conflict;

  return (
    <View style={styles.card} testID="about-diagnostics-card">
      <View style={styles.headerRow}>
        <View style={styles.flexOne}>
          <Text style={styles.title}>{t("diagnostics.title")}</Text>
          <Text style={styles.subtitle}>
            v{BUILD_PROVENANCE.version} ({BUILD_PROVENANCE.buildNumber}) • {shortSha}
          </Text>
        </View>
        <Pressable
          hitSlop={4}
          style={({ pressed }) => [styles.expandBtn, pressed && styles.pressed]}
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={t("diagnostics.toggleA11y")}
          testID="toggle-diagnostics-btn"
        >
          <Text style={styles.expandBtnText}>
            {expanded ? t("diagnostics.hide") : t("diagnostics.details")}
          </Text>
        </Pressable>
      </View>

      {/* Warning Banner if Gateway is on Docker-conflicted Port 8080 */}
      {isPort8080 && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{t("diagnostics.gatewayWarningDocker")}</Text>
        </View>
      )}

      {expanded && (
        <View style={styles.detailsGroup}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("diagnostics.commitSha")}</Text>
            <Text selectable style={styles.metaValue}>{BUILD_PROVENANCE.commitSha}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("diagnostics.branch")}</Text>
            <Text selectable style={styles.metaValue}>{BUILD_PROVENANCE.branch}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("diagnostics.timestamp")}</Text>
            <Text style={styles.metaValue}>{BUILD_PROVENANCE.buildTimestamp}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("diagnostics.runtime")}</Text>
            <Text style={styles.metaValue}>{BUILD_PROVENANCE.runtime}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("diagnostics.gateway")}</Text>
            <Text selectable style={styles.metaValue}>{BUILD_PROVENANCE.gatewayUrl}</Text>
          </View>

          <View style={styles.networkHintBox}>
            <Text style={styles.networkHintText}>{t("diagnostics.networkHints")}</Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionHeading}>{t("diagnostics.parityHeading")}</Text>
          <View style={styles.featureList}>
            {BUILD_PROVENANCE.features.map((feat) => {
              const isCertified = feat.status === "certified";
              const isPreview = feat.status === "preview";
              return (
                <View key={feat.key} style={styles.featureRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.featureLabel}>{feat.label}</Text>
                    {feat.prReference && (
                      <Text style={styles.featureRef}>{feat.prReference}</Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      isCertified
                        ? styles.pillCertified
                        : isPreview
                          ? styles.pillPreview
                          : styles.pillBlocked,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        isCertified
                          ? styles.pillTextCertified
                          : isPreview
                            ? styles.pillTextPreview
                            : styles.pillTextBlocked,
                      ]}
                    >
                      {isCertified
                        ? t("diagnostics.certified")
                        : isPreview
                          ? t("diagnostics.preview")
                          : t("diagnostics.blocked")}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(theme: NxsTheme, writingDirection: "ltr" | "rtl") {
  const textAlign = writingDirection === "rtl" ? "right" : "left";
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";

  return StyleSheet.create({
    card: {
      padding: 16,
      borderRadius: 14,
      backgroundColor: theme.surface.raised,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      gap: 12,
    },
    flexOne: {
      flex: 1,
    },
    headerRow: {
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      fontSize: 15,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    subtitle: {
      fontSize: 12,
      color: theme.text.secondary,
      marginTop: 2,
      textAlign,
    },
    warningBanner: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.surface.canvas,
      borderWidth: 1,
      borderColor: theme.border.warning,
    },
    warningText: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.state.warning,
      textAlign,
    },
    expandBtn: {
      minHeight: nxsTokens.touch.minimum,
      paddingHorizontal: 12,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.canvas,
      justifyContent: "center",
      alignItems: "center",
    },
    expandBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.action.primary,
    },
    detailsGroup: {
      gap: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    metaRow: {
      gap: 2,
    },
    metaLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.text.secondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      textAlign,
    },
    metaValue: {
      fontSize: 13,
      color: theme.text.primary,
      textAlign,
    },
    networkHintBox: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.surface.canvas,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      marginTop: 4,
    },
    networkHintText: {
      fontSize: 11,
      color: theme.text.secondary,
      lineHeight: 15,
      textAlign,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border.subtle,
      marginVertical: 4,
    },
    sectionHeading: {
      fontSize: 13,
      fontWeight: "800",
      color: theme.text.primary,
      marginBottom: 2,
      textAlign,
    },
    featureList: {
      gap: 8,
    },
    featureRow: {
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    featureLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text.primary,
      textAlign,
    },
    featureRef: {
      fontSize: 11,
      color: theme.text.secondary,
      textAlign,
    },
    statusPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1,
    },
    pillCertified: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.state.success,
    },
    pillPreview: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.border.warning,
    },
    pillBlocked: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.border.error,
    },
    statusPillText: {
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    pillTextCertified: {
      color: theme.state.success,
    },
    pillTextPreview: {
      color: theme.state.warning,
    },
    pillTextBlocked: {
      color: theme.state.error,
    },
    pressed: { opacity: 0.78 },
  });
}
