import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

function fail(message) {
  throw new Error(`NXS foundation check failed: ${message}`);
}

function read(path) {
  if (!existsSync(path)) fail(`required file is missing: ${path}`);
  return readFileSync(path, "utf8");
}

function requireText(path, needle, label) {
  if (!read(path).includes(needle)) fail(label);
}

function requireAbsent(path, label) {
  if (existsSync(path)) fail(label);
}

function walk(path, results = []) {
  if (!existsSync(path)) return results;
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".expo" || entry === "dist") continue;
      walk(full, results);
    } else {
      results.push(full);
    }
  }
  return results;
}

const manifest = read("nxs-experience-manifest.yaml");
for (const [needle, label] of [
  ['version: "1.0"', "NXS 1.0 manifest is not pinned"],
  ['ios: true', "iOS support is not declared"],
  ['android: true', "Android support is not declared"],
  ['pseudolocalization: "required"', "pseudolocalization obligation is missing"],
  ['pseudo_ltr: "en-XA"', "expanded LTR pseudolocale is missing"],
  ['pseudo_rtl: "ar-XB"', "RTL pseudolocale is missing"],
  ['level: "strict"', "strict certification is not declared"],
]) {
  if (!manifest.includes(needle)) fail(label);
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.main !== "expo-router/entry") {
  fail("Expo Router is no longer the application entry");
}
for (const dependency of [
  "expo-router",
  "expo-secure-store",
  "expo-localization",
  "@react-native-community/netinfo",
]) {
  if (!packageJson.dependencies?.[dependency]) {
    fail(`required dependency is missing: ${dependency}`);
  }
}

const appJson = JSON.parse(read("app.json"));
if (appJson.expo?.orientation !== "default") {
  fail("orientation adaptation is not enabled");
}
if (appJson.expo?.userInterfaceStyle !== "automatic") {
  fail("semantic light/dark theme adaptation is not enabled");
}

const plugins = appJson.expo?.plugins ?? [];
const pluginNames = plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
for (const plugin of ["expo-router", "expo-secure-store", "expo-localization"]) {
  if (!pluginNames.includes(plugin)) fail(`Expo config plugin is missing: ${plugin}`);
}

requireText(
  "src/nxs/tokens/index.ts",
  "minimum: 48",
  "48x48 NXS touch floor is not encoded",
);
requireText(
  "src/auth/session-storage.ts",
  'from "expo-secure-store"',
  "SecureStore is no longer the credential-storage authority",
);
requireAbsent("App.tsx", "legacy App.tsx application entry returned");
requireAbsent("index.ts", "legacy index.ts application entry returned");

requireText(
  "../docs/mobile/TENGASELL_MOBILE_01_NXS_FOUNDATION.md",
  "Navigation contract",
  "NXS navigation contract evidence is missing",
);
requireText(
  "src/nxs/localization/catalog.ts",
  '"en-XA"',
  "expanded pseudolocale implementation is missing",
);
requireText(
  "src/nxs/localization/catalog.ts",
  '"ar-XB"',
  "RTL pseudolocale implementation is missing",
);
requireText(
  "src/nxs/context/NxsProvider.tsx",
  "EXPO_PUBLIC_NXS_LOCALE",
  "pseudolocale runtime override is missing",
);

for (const route of [
  "src/app/_layout.tsx",
  "src/app/index.tsx",
  "src/app/auth/login.tsx",
  "src/app/account/index.tsx",
]) {
  requireText(route, "useNxsText", `route is not consuming string resources: ${route}`);
  const source = read(route);
  if (/accessibilityLabel\s*=\s*["']/.test(source)) {
    fail(`hard-coded accessibility label found in ${route}`);
  }
  if (/\blabel\s*=\s*["']/.test(source)) {
    fail(`hard-coded custom-control label found in ${route}`);
  }
}

const sourceFiles = walk("src").filter((path) => /\.(ts|tsx|js|jsx)$/.test(path));
for (const path of sourceFiles) {
  const source = read(path);
  if (/https?:\/\/[^\s"'\x60]+\.trycloudflare\.com/i.test(source)) {
    fail(`embedded permanent Quick Tunnel URL found in ${relative(".", path)}`);
  }
}

const interactiveFiles = sourceFiles.filter((path) => read(path).includes("<Pressable"));
for (const path of interactiveFiles) {
  const source = read(path);
  if (path.includes("src/app/") && !source.includes("hitSlop={4}")) {
    fail(`custom Pressable lacks bounded hitSlop review in ${relative(".", path)}`);
  }

  for (const match of source.matchAll(/min(?:Height|Width):\s*(\d+)/g)) {
    const value = Number(match[1]);
    if (value < 48) {
      fail(
        `custom interactive geometry below NXS floor (${value}) in ${relative(".", path)}`,
      );
    }
  }
}

requireText(
  "src/nxs/components/NxsButton.tsx",
  "minHeight: tokens.touch.minimum",
  "NxsButton no longer consumes the semantic touch floor",
);
requireText(
  "src/nxs/components/NxsButton.tsx",
  "minWidth: tokens.touch.minimum",
  "NxsButton no longer consumes the semantic touch floor",
);

for (const path of sourceFiles) {
  const source = read(path);
  if (/from\s+["'](?:@expo\/cli|zod)["']/.test(source)) {
    fail(`CLI-only vulnerable dependency imported into mobile runtime source: ${relative(".", path)}`);
  }
}

console.log(
  `NXS R2 foundation static checks passed: ${interactiveFiles.length} interactive source files audited.`,
);
