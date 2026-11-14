#!/usr/bin/env node
// mobile/scripts/verify-evidence-manifest.mjs
// Verifies all evidence artifacts exist in docs/mobile/evidence/ and their
// sha256 checksums strictly match mobile-uat-manifest.json.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const manifestPath = path.resolve(rootDir, "mobile/mobile-uat-manifest.json");
const evidenceDir = path.resolve(rootDir, "docs/mobile/evidence");

console.log("[VERIFY-EVIDENCE] Reading UAT evidence manifest:", manifestPath);

if (!fs.existsSync(manifestPath)) {
  console.error("[VERIFY-EVIDENCE] FAILED: Manifest file not found:", manifestPath);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error("[VERIFY-EVIDENCE] FAILED: Could not parse manifest JSON:", err.message);
  process.exit(1);
}

const artifacts = manifest.evidenceArtifacts;
if (!Array.isArray(artifacts) || artifacts.length === 0) {
  console.error("[VERIFY-EVIDENCE] FAILED: evidenceArtifacts array is empty or missing in manifest");
  process.exit(1);
}

let passed = 0;
let failed = 0;

console.log(`[VERIFY-EVIDENCE] Auditing ${artifacts.length} registered evidence artifacts against ${evidenceDir}...`);

for (const art of artifacts) {
  const filePath = path.join(evidenceDir, art.filename);
  if (!fs.existsSync(filePath)) {
    console.error(`[VERIFY-EVIDENCE] ❌ MISSING: ${art.filename} not found at ${filePath}`);
    failed++;
    continue;
  }

  const content = fs.readFileSync(filePath);
  const actualHash = crypto.createHash("sha256").update(content).digest("hex");

  if (actualHash.toLowerCase() !== art.sha256.toLowerCase()) {
    console.error(`[VERIFY-EVIDENCE] ❌ CHECKSUM MISMATCH for ${art.filename}:`);
    console.error(`    Expected: ${art.sha256}`);
    console.error(`    Actual:   ${actualHash}`);
    failed++;
  } else {
    console.log(`[VERIFY-EVIDENCE] ✔ ${art.filename} matches (${actualHash.slice(0, 16)}...)`);
    passed++;
  }
}

console.log(`\n[VERIFY-EVIDENCE] Summary: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
  console.error("[VERIFY-EVIDENCE] FAILED: One or more evidence artifacts failed verification.");
  process.exit(1);
}

console.log("[VERIFY-EVIDENCE] SUCCESS: All evidence artifacts verified with bit-exact SHA-256 integrity.");
