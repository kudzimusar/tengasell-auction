#!/usr/bin/env node
// mobile/scripts/generate-build-metadata.mjs
// Generates transient build-time provenance metadata.
// This file is invoked during CI/export and its output is gitignored.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI flags
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const customPrSource = getArg("--pr-source");
const customTestedMerge = getArg("--tested-merge");
const customManifest = getArg("--manifest");
const customOutput = getArg("--output");

const targetFile = customOutput
  ? path.resolve(process.cwd(), customOutput)
  : path.resolve(__dirname, "../src/lib/build-meta.json");

let commitSha = "UNKNOWN_COMMIT";
let branch = "unknown";
const buildTimestamp = new Date().toISOString();

try {
  commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  // Safe fallback if git is unavailable
}

try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
} catch {
  // Safe fallback
}

// Compute bundle digest if dist/ exists
let bundleDigest = undefined;
const distDir = path.resolve(__dirname, "../dist");
if (fs.existsSync(distDir)) {
  try {
    const hash = crypto.createHash("sha256");
    const collectFiles = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          collectFiles(full);
        } else if (ent.isFile()) {
          hash.update(fs.readFileSync(full));
        }
      }
    };
    collectFiles(distDir);
    bundleDigest = `sha256:${hash.digest("hex")}`;
  } catch {
    // optional digest
  }
}

const buildId = `${branch.replace(/[^a-zA-Z0-9_-]/g, "_")}-${commitSha.slice(0, 10)}`;

const meta = {
  commitSha,
  branch,
  buildTimestamp,
  buildId,
  isKnown: commitSha !== "UNKNOWN_COMMIT",
  prSourceSha: customPrSource ?? commitSha,
  testedMergeSha: customTestedMerge ?? commitSha,
  manifestSha: customManifest ?? commitSha,
  bundleDigest,
};

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, JSON.stringify(meta, null, 2) + "\n", "utf8");
console.log(`[PROVENANCE] Generated transient build metadata: ${targetFile}`);
console.log(`[PROVENANCE] Commit SHA: ${commitSha} (${branch})`);
if (bundleDigest) {
  console.log(`[PROVENANCE] Bundle Digest: ${bundleDigest}`);
}
