// REL-002 / REL-004 boundary guard — no release material may enter the app
// source, the mobile scripts or CI configuration.
//
// This is deliberately a narrow, explainable rule set rather than a general
// secret scanner: the release keystore lives outside the repository, and the
// only way it can leak into engineering artefacts is by someone pasting a key
// block, a keystore path plus password, or a signing environment variable.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "scripts", "app", "tests", ".github"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", ".git"]);

const RULES = [
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "keystore password assignment", re: /TGS_KEYSTORE_PASSWORD\s*=\s*\S+/ },
  { name: "storePassword literal", re: /storePassword\s*=\s*["']?[^\s"']{4,}/ },
  { name: "keyPassword literal", re: /keyPassword\s*=\s*["']?[^\s"']{4,}/ },
  { name: "keystore binary reference", re: /\.keystore["']?\s*[:=]\s*["'][^"']+["']/ },
];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const root = process.argv[2] ?? ".";
const files = ROOTS.flatMap((dir) => walk(join(root, dir), []));

const findings = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      findings.push(`${relative(root, file)}: ${rule.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("release material found in engineering artefacts:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(
  `release-secret scan passed: ${files.length} files across ${ROOTS.join(", ")}; no keystore, key block or signing password.`,
);
