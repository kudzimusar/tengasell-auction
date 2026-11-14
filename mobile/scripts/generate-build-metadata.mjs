#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetFile = path.resolve(__dirname, "../src/lib/build-meta.json");

let commitSha = "UNKNOWN_COMMIT";
let branch = "unknown";
let buildTimestamp = new Date().toISOString();

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

const buildId = `${branch.replace(/[^a-zA-Z0-9_-]/g, "_")}-${commitSha.slice(0, 10)}`;

const meta = {
  commitSha,
  branch,
  buildTimestamp,
  buildId,
  isKnown: commitSha !== "UNKNOWN_COMMIT",
};

fs.writeFileSync(targetFile, JSON.stringify(meta, null, 2) + "\n", "utf8");
console.log(`Generated build metadata: ${targetFile}`);
