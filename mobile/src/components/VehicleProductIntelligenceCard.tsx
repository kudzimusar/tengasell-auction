// Gated Preview Component: Vehicle Product Intelligence & Reserve Status (PR #14 / PI-01D).
// Uncertified feature preview: clearly gated, fail-soft, and non-blocking.
// Canonical authority: PR #14 publicProductBundle / pi_vehicle_public.

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

  // Truthful category check: strictly schema-based, zero regex/title heuristics
  const isVehicle =
    item.category?.toLowerCase() === "vehicles" ||
    item.category?.toLowerCase() === "cars" ||
    item.asset_kind === "vehicle" ||
    item.vehicle_projection != null;

  // Truthful reserve disclosure: strictly canonical public reserve_disclosure
  // Never infer "No Reserve" merely because private reserve_price is absent.
  // Never expose raw reserve amount.
  const disclosure = item.reserve_disclosure ?? item.reserveDisclosure ?? "UNSPECIFIED";
  const isNoReserve = disclosure === "NO_RESERVE";
  const isReserveApplies = disclosure === "RESERVE_APPLIES";
  const isUpsetApplies = disclosure === "UPSET_APPLIES";

  const vp = item.vehicle_projection;
  const isVerified = vp?.verification_state === "VERIFIED";

  return (
    <View style={styles.card} testID="product-intelligence-card">
      {/* Header: Non-blocking Preview Notice */}
      <View style={styles.headerRow}>
        <View style={styles.pillPreview}>
          <Text style={styles.pillTextPreview}>{t("pi.previewBadge")}</Text>
        </View>
        <Text style={styles.previewNotice}>{t("pi.nonBlocking")}</Text>
      </View>

      {/* Reserve Disclosure (PR #14 canonical requirement) */}
      <View style={styles.reserveRow}>
        <Text style={styles.reserveLabel}>{t("pi.reserveStatus")}:</Text>
        <View
          style={[
            styles.reserveBadge,
            isNoReserve
              ? styles.reserveBadgeNoReserve
              : isReserveApplies || isUpsetApplies
                ? styles.reserveBadgeApplies
                : styles.reserveBadgeUnspecified,
          ]}
        >
          <Text
            style={[
              styles.reserveBadgeText,
              isNoReserve
                ? styles.reserveTextNoReserve
                : isReserveApplies || isUpsetApplies
                  ? styles.reserveTextApplies
                  : styles.reserveTextUnspecified,
            ]}
          >
            {isNoReserve
              ? t("pi.noReserve")
              : isReserveApplies
                ? t("pi.reserveApplies")
                : isUpsetApplies
                  ? t("pi.upsetApplies")
                  : t("pi.notDisclosed")}
          </Text>
        </View>
      </View>

      {/* Vehicle Specification Grid: ONLY rendered for vehicle category */}
      {isVehicle ? (
        <View style={styles.vehicleSection}>
          <Text style={styles.sectionTitle}>{t("pi.specsTitle")}</Text>
          <View style={styles.specGrid}>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.makeModel")}</Text>
              <Text style={styles.specValue}>
                {[vp?.make, vp?.model].filter(Boolean).join(" ") || t("pi.notProvided")}
              </Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.year")}</Text>
              <Text style={styles.specValue}>
                {vp?.year ? String(vp.year) : t("pi.notProvided")}
              </Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.mileage")}</Text>
              <Text style={styles.specValue}>
                {vp?.mileage != null ? `${vp.mileage.toLocaleString()} km` : t("pi.notProvided")}
              </Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.transmission")}</Text>
              <Text style={styles.specValue}>{vp?.transmission ?? t("pi.notProvided")}</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.fuelType")}</Text>
              <Text style={styles.specValue}>{vp?.fuel_type ?? t("pi.notProvided")}</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.bodyType")}</Text>
              <Text style={styles.specValue}>{vp?.body_type ?? t("pi.notProvided")}</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.source")}</Text>
              <Text style={styles.specValue}>{vp?.odometer_source ?? "SELLER_DECLARED"}</Text>
            </View>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>{t("pi.vinClassification")}</Text>
              <Text style={styles.specValue}>
                {vp?.vin_classification === "RECORDED"
                  ? t("pi.vinRecorded")
                  : t("pi.vinNotRecorded")}
              </Text>
            </View>
          </View>

          {/* Verification Status Pill */}
          <View style={styles.verificationRow}>
            <Text style={styles.verificationLabel}>{t("pi.verification")}:</Text>
            <View
              style={[
                styles.verificationBadge,
                isVerified ? styles.verificationBadgeVerified : styles.verificationBadgeUnverified,
              ]}
            >
              <Text
                style={[
                  styles.verificationBadgeText,
                  isVerified ? styles.verificationTextVerified : styles.verificationTextUnverified,
                ]}
              >
                {isVerified ? t("pi.verified") : t("pi.unverified")}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.generalNoticeBox}>
          <Text style={styles.generalNoticeText}>{t("pi.generalLotNotice")}</Text>
        </View>
      )}

      {/* Truthful Trust & Transparency Notice (no unproven authenticity claims) */}
      <View style={styles.trustRow}>
        <View style={styles.flexOne}>
          <Text style={styles.trustTitle}>{t("pi.trustTitle")}</Text>
          <Text style={styles.trustSubtitle}>{t("pi.trustSubtitle")}</Text>
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
    reserveBadgeApplies: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.border.warning,
    },
    reserveBadgeUnspecified: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.border.subtle,
    },
    reserveBadgeText: {
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.3,
    },
    reserveTextNoReserve: {
      color: theme.state.success,
    },
    reserveTextApplies: {
      color: theme.state.warning,
    },
    reserveTextUnspecified: {
      color: theme.text.secondary,
    },
    vehicleSection: {
      marginTop: 4,
      gap: 8,
      paddingTop: 8,
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
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    specBox: {
      width: "48%",
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.surface.canvas,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      gap: 2,
    },
    specLabel: {
      fontSize: 10,
      fontWeight: "700",
      color: theme.text.secondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      textAlign,
    },
    specValue: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.text.primary,
      textAlign,
    },
    verificationRow: {
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    verificationLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.text.primary,
      textAlign,
    },
    verificationBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: nxsTokens.radius.pill,
      borderWidth: 1,
    },
    verificationBadgeVerified: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.state.success,
    },
    verificationBadgeUnverified: {
      backgroundColor: theme.surface.canvas,
      borderColor: theme.border.warning,
    },
    verificationBadgeText: {
      fontSize: 10,
      fontWeight: "700",
    },
    verificationTextVerified: {
      color: theme.state.success,
    },
    verificationTextUnverified: {
      color: theme.state.warning,
    },
    generalNoticeBox: {
      padding: 10,
      borderRadius: 8,
      backgroundColor: theme.surface.canvas,
      borderWidth: 1,
      borderColor: theme.border.subtle,
    },
    generalNoticeText: {
      fontSize: 12,
      color: theme.text.secondary,
      textAlign,
    },
    trustRow: {
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 8,
    },
    trustTitle: {
      fontSize: 12,
      fontWeight: "800",
      color: theme.text.primary,
      textAlign,
    },
    trustSubtitle: {
      fontSize: 11,
      color: theme.text.secondary,
      marginTop: 2,
      lineHeight: 15,
      textAlign,
    },
  });
}
