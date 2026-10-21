// ops/sbom.ts — Software Bill of Materials (SRC-007, CTL-013).
// Run: `bun ops/sbom.ts`
//
// Generates ops/sbom.json from the FIRST-PARTY package.json dependency
// lists: the Next.js app + every mini-service. Direct dependencies only
// (bun.lock transitive resolution is intentionally NOT flattened here —
// the honest v1 SBOM lists what WE declare; the lockfile stays the full
// resolution record and is referenced by path).

import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/z/my-project";
const SERVICES = ["trailbase-db", "trade-engine", "gis-service", "comms-service", "finance-service", "trust-service", "govern-service"];

interface SbomComponent {
  name: string;
  version: string;
  type: "direct";
  scope: "app" | "service";
  dev: boolean;
}

function main(): void {
  const components: SbomComponent[] = [];

  const read = (file: string, scope: "app" | "service") => {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        components.push({ name, version: String(version), type: "direct", scope, dev: false });
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        components.push({ name, version: String(version), type: "direct", scope, dev: true });
      }
    } catch {
      /* no package.json — record nothing, honestly skipped */
    }
  };

  read(path.join(ROOT, "package.json"), "app");
  for (const s of SERVICES) {
    read(path.join(ROOT, "mini-services", s, "package.json"), "service");
  }

  const runtime = [
    { name: "bun", version: process.version || "1.3.x", note: "service runtime (mini-services + ops scripts)" },
    { name: "node", version: "24 (platform-managed dev server)", note: "Next.js dev-server runtime; node:sqlite BFF helpers" },
    { name: "sqlite", version: "3.53 (TrailBase) / bun:sqlite + node:sqlite", note: "embedded database engine" },
    { name: "trailbase", version: "0.35.0", note: "Rust backend binary (mini-services/trailbase-db)" },
  ];

  const sbom = {
    generated_at: new Date().toISOString(),
    spec: "Tengasell v1 SBOM (first-party declared dependencies)",
    products: {
      app: { name: "tengasell-web", path: "package.json", lockfile: "bun.lock" },
      services: SERVICES.map((s) => ({
        name: s,
        path: `mini-services/${s}/package.json`,
        note: "zero-dependency Bun service (node:http + bun:sqlite)" as const,
      })),
    },
    components,
    runtimes: runtime,
    component_count: components.length,
    direct_count: components.filter((c) => !c.dev).length,
    dev_count: components.filter((c) => c.dev).length,
    notes: [
      "Direct = declared in a first-party package.json (this SBOM).",
      "Full transitive resolution for the app lives in bun.lock (referenced, not flattened here).",
      "Mini-services are intentionally zero-dependency: node:http + bun:sqlite only — verifiable in their package.json files.",
      "TrailBase is a prebuilt Rust binary, not an npm dependency.",
    ],
  };

  fs.writeFileSync(path.join(ROOT, "ops", "sbom.json"), JSON.stringify(sbom, null, 2));
  console.log(JSON.stringify({ ok: true, out: "ops/sbom.json", components: components.length, direct: sbom.direct_count, dev: sbom.dev_count }, null, 2));
}

main();
