// mobile/tests/build-provenance.test.mjs
// Verifies exact-build provenance identities, fallback safety, and truthful parity register.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILD_PROVENANCE,
  resolveBundleSourceIdentity,
  validateProvenance,
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

test("PROV-05 (Negative): rejects missing or UNKNOWN provenance in release mode", () => {
  const emptySource = resolveBundleSourceIdentity(null);
  const result = validateProvenance(emptySource, { isRelease: true });

  assert.equal(result.valid, false, "Release build must fail validation if provenance is unknown");
  assert.ok(result.errors.some((e) => e.includes("UNKNOWN")), "Must report UNKNOWN identity error");
});

test("PROV-06 (Negative): detects stale or mismatched manifest SHA", () => {
  const currentHead = "8b5a526393a36f523ce14138b4221bb692fe63d1";
  const staleManifestTarget = "d76daae1095842a1ad09039d022aa1febc486cdf";

  const source = resolveBundleSourceIdentity({
    commitSha: currentHead,
    branch: "feat/tengasell-mobile-ux-parity-01-draft",
    buildTimestamp: "2026-11-14T20:00:00Z",
    manifestSha: currentHead,
  });

  const result = validateProvenance(source, {
    expectedManifestSha: staleManifestTarget,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => e.includes("Manifest SHA mismatch")),
    "Must flag stale manifest SHA reference",
  );
});

test("PROV-07 (Negative): detects bundle digest mismatch", () => {
  const source = resolveBundleSourceIdentity({
    commitSha: "8b5a526393a36f523ce14138b4221bb692fe63d1",
    bundleDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  });

  const result = validateProvenance(source, {
    expectedBundleDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => e.includes("Bundle digest mismatch")),
    "Must reject bundle digest mismatch",
  );
});

test("PROV-08 (Negative): validates distinct PR source SHA and CI merge SHA formats", () => {
  const sourceWithMalformedSha = resolveBundleSourceIdentity({
    commitSha: "8b5a526393a36f523ce14138b4221bb692fe63d1",
    prSourceSha: "not-a-sha",
    testedMergeSha: "invalid-sha-characters-xyz",
  });

  const result = validateProvenance(sourceWithMalformedSha);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Invalid prSourceSha")));
  assert.ok(result.errors.some((e) => e.includes("Invalid testedMergeSha")));
});

test("PROV-09 (Negative): distinguishes JS bundle update from native binary identity", () => {
  // A JS OTA bundle or Metro bundle source change must never mutate native binary identity
  const native = BUILD_PROVENANCE.nativeBinary;
  const bundle = BUILD_PROVENANCE.bundleSource;

  assert.equal(native.appName, "TengaSell");
  assert.equal(native.bundleId, "com.tengasell.app");
  assert.equal(native.version, "0.1.0");
  assert.equal(native.buildNumber, "1");

  // Bundle source commit SHA is distinct from binary version string
  assert.notEqual(native.version, bundle.commitSha);
  assert.notEqual(native.buildNumber, bundle.buildId);
});
