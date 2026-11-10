// REL-002 / REL-004 boundary guard — no release material may enter source,
// scripts, CI configuration or credential files.
//
// ICR03 fix: the previous version resolved its roots under mobile/, so
// `.github` and `app/` never existed and walk() silently returned nothing.
// A scan that can pass by finding no directories is not a control. Roots are now
// resolved from the repository root, and a missing required root fails closed.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const mobileRoot = resolve(repoRoot, "mobile");

const REQUIRED_ROOTS = [
  join(mobileRoot, "src"),
  join(mobileRoot, "scripts"),
  join(mobileRoot, "tests"),
  join(repoRoot, ".github"),
];

const OPTIONAL_ROOTS = [join(mobileRoot, "app")];

const REQUIRED_FILES = [join(mobileRoot, "app.json"), join(mobileRoot, "package.json")];

const OPTIONAL_FILES = [
  join(mobileRoot, "eas.json"),
  join(mobileRoot, "credentials.json"),
  join(repoRoot, "eas.json"),
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", ".git", "android", "ios"]);
const SELF = fileURLToPath(import.meta.url);

const RULES = [
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "keystore password assignment", re: /TGS_KEYSTORE_PASSWORD\s*=\s*\S+/ },
  { name: "storePassword literal", re: /storePassword"?\s*[:=]\s*["']?[^\s"']{4,}/ },
  { name: "keyPassword literal", re: /keyPassword"?\s*[:=]\s*["']?[^\s"']{4,}/ },
  { name: "keystorePassword literal", re: /keystorePassword"?\s*[:=]\s*["'][^"']+["']/ },
  { name: "keystore binary reference", re: /\.(?:keystore|jks|p12)["']?\s*[:=]\s*["'][^"']+["']/ },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

for (const root of REQUIRED_ROOTS) {
  if (!existsSync(root)) {
    console.error(`release-secret scan failed: required root is missing: ${relative(repoRoot, root)}`);
    process.exit(1);
  }
}

const files = new Set();
for (const root of [...REQUIRED_ROOTS, ...OPTIONAL_ROOTS]) {
  if (existsSync(root)) for (const file of walk(root)) files.add(file);
}
for (const file of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
  if (existsSync(file)) files.add(file);
}
files.delete(SELF);

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) findings.push(`${relative(repoRoot, file)}: ${rule.name}`);
  }
}

if (findings.length > 0) {
  console.error("release material found in engineering artefacts:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(
  `release-secret scan passed: ${files.size} files across ` +
    `${REQUIRED_ROOTS.map((r) => relative(repoRoot, r)).join(", ")} plus credential files.`,
);
