import { readFileSync } from "node:fs";

function requireText(path, needle, label) {
  const value = readFileSync(path, "utf8");
  if (!value.includes(needle)) {
    throw new Error(`NXS foundation check failed: ${label}`);
  }
}

requireText(
  "nxs-experience-manifest.yaml",
  'version: "1.0"',
  "NXS 1.0 manifest is not pinned",
);
requireText(
  "src/nxs/tokens/index.ts",
  "minimum: 48",
  "48x48 NXS touch floor is not encoded",
);
requireText(
  "app.json",
  '"orientation": "default"',
  "orientation adaptation is not enabled",
);
requireText(
  "app.json",
  '"userInterfaceStyle": "automatic"',
  "semantic light/dark theme adaptation is not enabled",
);
requireText(
  "../docs/mobile/TENGASELL_MOBILE_01_NXS_FOUNDATION.md",
  "Navigation contract",
  "NXS navigation contract evidence is missing",
);

console.log("NXS foundation static checks passed.");
