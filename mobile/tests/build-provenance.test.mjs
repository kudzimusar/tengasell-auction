// mobile/tests/build-provenance.test.mjs
// Verifies exact-build provenance identities, fallback safety, and truthful parity register.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILD_PROVENANCE,
  resolveBundleSourceIdentity,
} from "../src/lib/build-info.ts";

test("PROV-01: distinguishes all five core provenance identities", () => {
  // 1. Native Binary Identity
  assert.ok(BUILD_PROVENANCE.nativeBinary, "nativeBinary identity must be defined");
  assert.equal(BUILD_PROVENANCE.nativeBinary.appName, "TengaSell");
  assert.equal(BUILD_PROVENANCE.nativeBinary.bundleId, "com.tengasell.app");
  assert.equal(BUILD_PROVENANCE.nativeBinary.version, "0.1.0");
  assert.equal(BUILD_PROVENANCE.nativeBinary.buildNumber, "1");

  // 2. Bundle Source Identity
  assert.ok(BUILD_PROVENANCE.bundleSource, "bundleSource identity must be defined");
  assert.equal(typeof BUILD_PROVENANCE.bundleSource.commitSha, "string");
  assert.equal(typeof BUILD_PROVENANCE.bundleSource.branch, "string");
  assert.equal(typeof BUILD_PROVENANCE.bundleSource.buildTimestamp, "string");

  // 3. Metro Server Identity
  assert.ok(BUILD_PROVENANCE.metroServer, "metroServer identity must be defined");
  assert.equal(typeof BUILD_PROVENANCE.metroServer.isDevelopment, "boolean");

  // 4. Backend Gateway Identity
  assert.ok(BUILD_PROVENANCE.gateway, "gateway identity must be defined");
  assert.equal(typeof BUILD_PROVENANCE.gateway.gatewayUrl, "string");
  assert.equal(typeof BUILD_PROVENANCE.gateway.isPort8080Conflict, "boolean");

  // 5. Runtime Engine Version
  assert.ok(BUILD_PROVENANCE.runtimeEngine.includes("Expo SDK 58"), "runtimeEngine must identify Expo SDK 58");
});

test("PROV-02: fails safely with UNKNOWN defaults when metadata is missing or corrupted", () => {
  const emptyFallback = resolveBundleSourceIdentity(null);
  assert.equal(emptyFallback.commitSha, "UNKNOWN_COMMIT");
  assert.equal(emptyFallback.branch, "unknown");
  assert.equal(emptyFallback.isKnown, false);

  const corruptedFallback = resolveBundleSourceIdentity({ commitSha: "" });
  assert.equal(corruptedFallback.commitSha, "UNKNOWN_COMMIT");
  assert.equal(corruptedFallback.isKnown, false);

  const validParsed = resolveBundleSourceIdentity({
    commitSha: "abc123456789",
    branch: "feat/my-branch",
    buildTimestamp: "2026-11-14T10:00:00Z",
  });
  assert.equal(validParsed.commitSha, "abc123456789");
  assert.equal(validParsed.branch, "feat/my-branch");
  assert.equal(validParsed.isKnown, true);
});

test("PROV-03: parity register contains only truthful, scope-specific certification labels", () => {
  const allowedStatuses = new Set(["implemented", "preview", "pending_review", "blocked"]);

  for (const feat of BUILD_PROVENANCE.features) {
    assert.ok(
      allowedStatuses.has(feat.status),
      `Feature ${feat.key} must have a truthful status, got '${feat.status}'`,
    );

    // Directive P0: Must NOT claim SEC-01 server authority is certified merely due to client compatibility logic
    if (feat.key === "sec01") {
      assert.notEqual(feat.status, "certified", "SEC-01 cannot be labeled 'certified' before independent server sign-off");
      assert.equal(feat.status, "pending_review");
    }

    // Directive P0: Physical / Android hardware unavailable in container must be BLOCKED
    if (feat.key === "and01") {
      assert.equal(feat.status, "blocked", "Unavailable Android hardware must be explicitly labeled blocked");
    }
  }
});

test("PROV-04: convenience accessors preserve backwards compatibility with UI components", () => {
  assert.equal(BUILD_PROVENANCE.appName, "TengaSell");
  assert.equal(BUILD_PROVENANCE.version, "0.1.0");
  assert.equal(BUILD_PROVENANCE.buildNumber, "1");
  assert.equal(BUILD_PROVENANCE.commitSha, BUILD_PROVENANCE.bundleSource.commitSha);
  assert.equal(BUILD_PROVENANCE.branch, BUILD_PROVENANCE.bundleSource.branch);
  assert.equal(BUILD_PROVENANCE.gatewayUrl, BUILD_PROVENANCE.gateway.gatewayUrl);
});
