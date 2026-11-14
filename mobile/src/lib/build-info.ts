// Build provenance and diagnostics metadata for TengaSell Mobile.
// NEVER expose secrets, credentials, or session tokens here.

import { Platform } from "react-native";
import { getCanonicalBaseUrl } from "./trailbase";

export interface BuildProvenance {
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  commitSha: string;
  branch: string;
  buildTimestamp: string;
  runtime: string;
  gatewayUrl: string;
  isPort8080Conflict: boolean;
  platformTarget: string;
  networkGuide: {
    iosSimulator: string;
    androidEmulator: string;
    physicalDevice: string;
  };
  environment: "development" | "staging" | "production";
  features: {
    key: string;
    label: string;
    status: "certified" | "preview" | "blocked";
    prReference?: string;
  }[];
}

const FALLBACK_GATEWAY = "http://127.0.0.1:19080";

export const BUILD_PROVENANCE: BuildProvenance = {
  appName: "TengaSell",
  bundleId: "com.tengasell.app",
  version: "0.1.0",
  buildNumber: "1",
  commitSha: "9bd369ad7000c7564195c1249d75759064706068",
  branch: "feat/tengasell-mobile-ux-parity-01-draft",
  buildTimestamp: "2026-11-14T05:01:00Z",
  runtime: `Expo SDK 58 (Hermes / React Native 0.88 / ${Platform.OS})`,
  get gatewayUrl() {
    return getCanonicalBaseUrl() ?? FALLBACK_GATEWAY;
  },
  get isPort8080Conflict() {
    const url = getCanonicalBaseUrl() ?? "";
    return url.includes(":8080");
  },
  platformTarget: Platform.select({
    ios: "iOS Simulator / Device",
    android: "Android Emulator / Device",
    default: "Web / Universal",
  }),
  networkGuide: {
    iosSimulator: "http://127.0.0.1:19080",
    androidEmulator: "http://10.0.2.2:19080",
    physicalDevice: "http://<LAN-IP>:19080",
  },
  environment: "development",
  features: [
    {
      key: "mob01",
      label: "NXS Foundation & Design Tokens",
      status: "certified",
      prReference: "PR #6",
    },
    {
      key: "mob02",
      label: "Marketplace Discovery & Layout",
      status: "certified",
      prReference: "PR #7",
    },
    {
      key: "mob03",
      label: "Live Bidding & Socket.IO Authority",
      status: "certified",
      prReference: "PR #9",
    },
    {
      key: "sec01",
      label: "Fail-Closed Auth & Revocation Lifecycle",
      status: "certified",
      prReference: "PR #12",
    },
    {
      key: "rec01",
      label: "Intelligent Recommendations Engine",
      status: "certified",
      prReference: "TENGASELL-REC-01",
    },
    {
      key: "pi01d",
      label: "Vehicle Product Intelligence & Reserve Status",
      status: "preview",
      prReference: "PR #14 (Draft)",
    },
    {
      key: "pi01e",
      label: "Structured Discovery, Facets & Comparison",
      status: "preview",
      prReference: "PR #15 (Draft)",
    },
    {
      key: "ux01",
      label: "Live Event Discovery & Authoritative Invariants",
      status: "preview",
      prReference: "PR #17 (Draft)",
    },
  ],
};
