import { readFileSync } from "node:fs";

// Dependency advisory policy (REL/SEC).
//
// Decision rule: no critical advisory is tolerated. A *high* advisory is
// accepted only when its root cause is the single known tooling-chain
// advisory (GHSA-mrhx-c7xc-m3w5, zod) — never by allow-listing a package name,
// which would hide future unrelated findings behind a familiar label.
//
// The chain is build/tooling only: zod is reached through the Expo CLI graph,
// not through mobile runtime imports of the marketplace client.

const KNOWN_ADVISORY = "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5";

const path = process.argv[2];
if (!path) throw new Error("usage: verify-dependency-audit.mjs <npm-audit.json>");

const audit = JSON.parse(readFileSync(path, "utf8"));
const vulnerabilities = audit.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities).sort();
const counts = audit.metadata?.vulnerabilities ?? {};

if ((counts.critical ?? 0) !== 0) {
  throw new Error("dependency audit contains a critical vulnerability");
}

const highRoots = [];

for (const name of names) {
  const issue = vulnerabilities[name];
  if (issue.severity !== "high") continue;

  const via = Array.isArray(issue.via) ? issue.via : [];
  const roots = via.filter((item) => typeof item === "object");
  const urls = roots.map((item) => item.url).filter(Boolean);

  const fullyExplained =
    roots.length > 0 && urls.length === roots.length && urls.every((url) => url === KNOWN_ADVISORY);

  if (!fullyExplained) {
    throw new Error(
      `high advisory requires fresh triage: ${name} (root: ${urls.join(", ") || "unknown"})`,
    );
  }
  highRoots.push(name);
}

const zod = vulnerabilities.zod;
if (!zod) {
  throw new Error("expected the known zod tooling chain; it has disappeared — re-run triage");
}
const advisory = (zod.via ?? []).find((item) => typeof item === "object");
if (!advisory || advisory.url !== KNOWN_ADVISORY) {
  throw new Error("zod advisory identity changed and requires fresh security triage");
}

console.log(
  JSON.stringify(
    {
      status: "KNOWN_TOOLING_CHAIN_REQUIRES_EXPO_PATCH",
      counts,
      packages: names,
      highExplainedByZod: [...new Set(highRoots)].sort(),
      advisory: advisory.url,
      affectedRange: advisory.range,
    },
    null,
    2,
  ),
);
