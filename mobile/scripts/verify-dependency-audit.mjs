import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: verify-dependency-audit.mjs <npm-audit.json>");

const audit = JSON.parse(readFileSync(path, "utf8"));
const vulnerabilities = audit.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities).sort();
const allowed = ["@expo/cli", "expo", "zod"];

if ((audit.metadata?.vulnerabilities?.critical ?? 0) !== 0) {
  throw new Error("dependency audit contains a critical vulnerability");
}

for (const name of names) {
  if (!allowed.includes(name)) {
    throw new Error(`dependency audit contains an untriaged package: ${name}`);
  }
}

for (const expected of allowed) {
  if (!vulnerabilities[expected]) {
    throw new Error(`expected R2 audit chain changed; missing ${expected}`);
  }
}

const zod = vulnerabilities.zod;
const advisory = Array.isArray(zod.via)
  ? zod.via.find((item) => typeof item === "object")
  : null;

if (!advisory || advisory.url !== "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5") {
  throw new Error("Zod advisory identity changed and requires fresh security triage");
}

console.log(
  JSON.stringify(
    {
      status: "KNOWN_TOOLING_CHAIN_REQUIRES_EXPO_PATCH",
      counts: audit.metadata.vulnerabilities,
      packages: names,
      advisory: advisory.url,
      affectedRange: advisory.range,
    },
    null,
    2,
  ),
);
