// Gated Preview Component: Vehicle Product Intelligence & Reserve Status (PR #14 / PI-01D).
// Uncertified feature preview: clearly gated, fail-soft, and non-blocking.

import { StyleSheet, Text, View } from "react-native";

import type { AuctionView } from "../lib/types";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

export interface VehicleProductIntelligenceCardProps {
  item: AuctionView;
}

export function VehicleProductIntelligenceCard({ item }: VehicleProductIntelligenceCardProps) {
  const { theme, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = createStyles(theme, writingDirection);

  const isVehicleCategory =
    item.category?.toLowerCase() === "vehicles" ||
    item.category?.toLowerCase() === "cars" ||
    item.category?.toLowerCase() === "motorcycles" ||
    item.title?.toLowerCase().includes("toyota") ||
    item.title?.toLowerCase().includes("honda") ||
    item.title?.toLowerCase().includes("ford") ||
    item.title?.toLowerCase().includes("nissan") ||
    item.title?.toLowerCase().includes("bmw") ||
    item.title?.toLowerCase().includes("mercedes");

  // Determine reserve disclosure state (PR #14)
  const hasReserve = item.reserve_price != null && item.reserve_price > 0;
  const reserveMet = hasReserve ? item.current_price >= (item.reserve_price ?? 0) : true;

  return (
    <View style={styles.card} testID="product-intelligence-card">
      <View style={styles.headerRow}>
        <View style={styles.pillPreview}>
          <Text style={styles.pillTextPreview}>{t("pi.previewBadge")}</Text>
        </View>
        <Text style={styles.previewNotice}>{t("pi.nonBlocking")}</Text>
      </View>

      {/* Reserve Disclosure (PR #14 requirement) */}
      <View style={styles.reserveRow}>
        <Text style={styles.reserveLabel}>{t("pi.reserveStatus")}:</Text>
        <View
          style={[
            styles.reserveBadge,
            !hasReserve
              ? styles.reserveBadgeNoReserve
              : reserveMet
                ? styles.reserveBadgeMet
                : styles.reserveBadgeNotMet,
          ]}
        >
          <Text
            style={[
              styles.reserveBadgeText,
              !hasReserve
                ? styles.reserveTextNoReserve
                : reserveMet
                  ? styles.reserveTextMet
                  : styles.reserveTextNotMet,
            ]}
          >
            {!hasReserve
              ? t("pi.noReserve")
              : reserveMet
                ? t("pi.reserveMet")
                : t("pi.reserveNotMet")}
          </Text>
        </View>
      </View>

      {/* Vehicle Specification Grid (if vehicle category) */}
      {isVehicleCategory && (
        <View style={styles.vehicleSection}>
          <Text style={styles.sectionTitle}>{t("pi.specsTitle")}</Text>
          <View style={styles.specGrid}>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.transmission")}</Text>
              <Text style={styles.specValue}>Automatic</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.fuelType")}</Text>
              <Text style={styles.specValue}>Diesel / Petrol</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.verification")}</Text>
              <Text style={styles.specValue}>{t("pi.physicalInspection")}</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.origin")}</Text>
              <Text style={styles.specValue}>{item.city || "Harare, ZW"}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Authenticity & Inspection Guarantee */}
      <View style={styles.guaranteeRow}>
        <Text style={styles.guaranteeIcon}>🛡</Text>
        <View style={styles.flexOne}>
          <Text style={styles.guaranteeTitle}>{t("pi.guaranteeTitle")}</Text>
          <Text style={styles.guaranteeSubtitle}>
            {t("pi.guaranteeSubtitle")}
          </Text>
        </View>
      </View>
    </View>
  );
}

function createStyles(theme: NxsTheme, writingDirection: "ltr" | "rtl") {
  const textAlign = writingDirection === "rtl" ? "right" : "left";
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";

  return StyleSheet.create({
    card: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: theme.surface.raised,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      gap: 10,
      marginTop: 8,
    },
    flexOne: {
      flex: 1,
    },
    headerRow: {
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
    },
    pillPreview: {
      backgroundColor: theme.surface.canvas,
      borderWidth: 1,
      borderColor: theme.border.warning,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: nxsTokens.radius.pill,
    },
    pillTextPreview: {
      color: theme.state.warning,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    previewNotice: {
      fontSize: 11,
      color: theme.text.secondary,
    },
    reserveRow: {
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    reserveLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.text.primary,
      textAlign,
    },
    reserveBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1,
    },
    reserveBadgeNoReserve: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.state.success,
    },
    reserveBadgeMet: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.state.success,
    },
    reserveBadgeNotMet: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.border.error,
    },
    reserveBadgeText: {
      fontSize: 12,
      fontWeight: "800",
    },
    reserveTextNoReserve: {
      color: theme.state.success,
    },
    reserveTextMet: {
      color: theme.state.success,
    },
    reserveTextNotMet: {
      color: theme.state.error,
    },
    vehicleSection: {
      gap: 6,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    specGrid: {
      flexDirection: rowDirection,
      flexWrap: "wrap",
      gap: 8,
    },
    specBox: {
      flex: 1,
      minWidth: "45%",
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.surface.canvas,
      gap: 2,
    },
    specLabel: {
      fontSize: 10,
      fontWeight: "700",
      color: theme.text.secondary,
      textTransform: "uppercase",
      textAlign,
    },
    specValue: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text.primary,
      textAlign,
    },
    guaranteeRow: {
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    guaranteeIcon: {
      fontSize: 20,
    },
    guaranteeTitle: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    guaranteeSubtitle: {
      fontSize: 11,
      color: theme.text.secondary,
      lineHeight: 15,
      textAlign,
    },
  });
}
