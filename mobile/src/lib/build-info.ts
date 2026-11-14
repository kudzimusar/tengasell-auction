// Build provenance and diagnostics metadata for TengaSell Mobile.
// NEVER expose secrets, credentials, or session tokens here.

import { getCanonicalBaseUrl } from "./trailbase.ts";

export interface NativeBinaryIdentity {
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  platform: string;
}

export interface BundleSourceIdentity {
  commitSha: string;
  branch: string;
  buildTimestamp: string;
  buildId: string;
  isKnown: boolean;
}

export interface MetroServerIdentity {
  isDevelopment: boolean;
  devServerUrl?: string;
}

export interface BackendGatewayIdentity {
  gatewayUrl: string;
  isPort8080Conflict: boolean;
  environment: "development" | "staging" | "production";
}

export type FeatureParityStatus =
  | "implemented"
  | "preview"
  | "pending_review"
  | "blocked";

export interface FeatureParityItem {
  key: string;
  label: string;
  status: FeatureParityStatus;
  prReference?: string;
  scopeNote?: string;
}

export interface BuildProvenance {
  nativeBinary: NativeBinaryIdentity;
  bundleSource: BundleSourceIdentity;
  metroServer: MetroServerIdentity;
  gateway: BackendGatewayIdentity;
  runtimeEngine: string;
  networkGuide: {
    iosSimulator: string;
    androidEmulator: string;
    physicalDevice: string;
  };
  features: FeatureParityItem[];
  // Backward compatibility convenience accessors
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
  environment: "development" | "staging" | "production";
}

const FALLBACK_GATEWAY = "http://127.0.0.1:19080";

function resolvePlatformOS(): string {
  if (typeof process !== "undefined" && process.platform === "darwin") {
    // In React Native iOS or macOS simulator
    return "ios";
  }
  return "universal";
}

// Safely load build-time metadata or fail soft with explicit UNKNOWN defaults
export function resolveBundleSourceIdentity(customMeta?: unknown): BundleSourceIdentity {
  try {
    const meta = (customMeta ?? require("./build-meta.json")) as Record<string, unknown>;
    if (meta && typeof meta.commitSha === "string" && meta.commitSha.length > 0) {
      return {
        commitSha: meta.commitSha,
        branch: typeof meta.branch === "string" ? meta.branch : "unknown",
        buildTimestamp: typeof meta.buildTimestamp === "string" ? meta.buildTimestamp : "unknown",
        buildId: typeof meta.buildId === "string" ? meta.buildId : `build-${meta.commitSha.slice(0, 8)}`,
        isKnown: meta.isKnown !== false && meta.commitSha !== "UNKNOWN_COMMIT",
      };
    }
  } catch {
    // build-meta.json not present or cannot be read; fail safe
  }

  return {
    commitSha: "UNKNOWN_COMMIT",
    branch: "unknown",
    buildTimestamp: "unknown",
    buildId: "unknown-build",
    isKnown: false,
  };
}

const bundleSource = resolveBundleSourceIdentity();
const platformOS = resolvePlatformOS();

const nativeBinary: NativeBinaryIdentity = {
  appName: "TengaSell",
  bundleId: "com.tengasell.app",
  version: "0.1.0",
  buildNumber: "1",
  platform: platformOS,
};

const metroServer: MetroServerIdentity = {
  isDevelopment: typeof __DEV__ !== "undefined" ? __DEV__ : false,
  devServerUrl: typeof __DEV__ !== "undefined" && __DEV__ ? "http://127.0.0.1:8081" : undefined,
};

const features: FeatureParityItem[] = [
  {
    key: "mob01",
    label: "NXS Foundation & Design Tokens",
    status: "implemented",
    prReference: "PR #6",
    scopeNote: "Local suite passed; merged to parent stack",
  },
  {
    key: "mob02",
    label: "Marketplace Discovery & Layout",
    status: "implemented",
    prReference: "PR #7",
    scopeNote: "Local suite passed; merged to parent stack",
  },
  {
    key: "mob03",
    label: "Live Bidding & Socket.IO Authority",
    status: "implemented",
    prReference: "PR #9",
    scopeNote: "Local suite passed; merged to parent stack",
  },
  {
    key: "sec01",
    label: "Fail-Closed Auth & Revocation Lifecycle",
    status: "pending_review",
    prReference: "PR #12",
    scopeNote: "Client compatibility verified; server authority pending independent review",
  },
  {
    key: "rec01",
    label: "Intelligent Recommendations Engine",
    status: "implemented",
    prReference: "TENGASELL-REC-01",
    scopeNote: "Client-side category/price clustering verified",
  },
  {
    key: "pi01d",
    label: "Vehicle Product Intelligence & Reserve Status",
    status: "preview",
    prReference: "PR #14 (Draft)",
    scopeNote: "Draft client preview; non-blocking fail-soft projection",
  },
  {
    key: "pi01e",
    label: "Structured Discovery, Facets & Comparison",
    status: "preview",
    prReference: "PR #15 (Draft)",
    scopeNote: "Draft client preview",
  },
  {
    key: "ux01",
    label: "Live Event Discovery & Authoritative Invariants",
    status: "preview",
    prReference: "PR #17 (Draft)",
    scopeNote: "Draft client preview",
  },
  {
    key: "and01",
    label: "Android Emulator & Hardware Devices",
    status: "blocked",
    prReference: "PHYS-UAT",
    scopeNote: "Blocked — unavailable physical/emulator hardware in current environment",
  },
];

export const BUILD_PROVENANCE: BuildProvenance = {
  nativeBinary,
  bundleSource,
  metroServer,
  get gateway(): BackendGatewayIdentity {
    const url = getCanonicalBaseUrl() ?? FALLBACK_GATEWAY;
    return {
      gatewayUrl: url,
      isPort8080Conflict: url.includes(":8080"),
      environment: "development" as const,
    };
  },
  runtimeEngine: `Expo SDK 58 (Hermes / React Native 0.88 / ${platformOS})`,
  networkGuide: {
    iosSimulator: "http://127.0.0.1:19080",
    androidEmulator: "http://10.0.2.2:19080",
    physicalDevice: "http://<LAN-IP>:19080",
  },
  features,

  // Convenience accessors mirroring previous shape
  get appName() { return nativeBinary.appName; },
  get bundleId() { return nativeBinary.bundleId; },
  get version() { return nativeBinary.version; },
  get buildNumber() { return nativeBinary.buildNumber; },
  get commitSha() { return bundleSource.commitSha; },
  get branch() { return bundleSource.branch; },
  get buildTimestamp() { return bundleSource.buildTimestamp; },
  get runtime() { return this.runtimeEngine; },
  get gatewayUrl() { return this.gateway.gatewayUrl; },
  get isPort8080Conflict() { return this.gateway.isPort8080Conflict; },
  platformTarget: "iOS Simulator / Device",
  environment: "development",
};
