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

const routeFiles = walk("src/app").filter((path) => /\.(ts|tsx|js|jsx)$/.test(path));
if (routeFiles.length === 0) {
  fail("no route files found under src/app; refusing to pass vacuously");
}

const componentFiles = walk("src/components").filter((path) => /\.(ts|tsx|js|jsx)$/.test(path));
if (componentFiles.length === 0) {
  fail("no component files found under src/components; refusing to pass vacuously");
}

for (const route of routeFiles) {
  const source = read(route);
  if (!source.includes("useNxsText")) {
    fail(`route is not consuming string resources: ${relative(".", route)}`);
  }
}

for (const uiFile of [...routeFiles, ...componentFiles]) {
  const source = codeOnly(read(uiFile));
  const rel = relative(".", uiFile);
  if (/accessibilityLabel\s*=\s*["']/.test(source)) {
    fail(`hard-coded accessibility label found in ${rel}`);
  }
  if (/\blabel\s*=\s*["']/.test(source)) {
    fail(`hard-coded custom-control label found in ${rel}`);
  }
  if (/\bplaceholder\s*=\s*["']/.test(source)) {
    fail(`hard-coded placeholder literal found in ${rel}`);
  }
  if (/#[0-9A-Fa-f]{3,8}\b/.test(source) || /\brgba\s*\(/.test(source)) {
    fail(`hard-coded color literal found outside NXS tokens in ${rel}`);
  }
  if (source.includes("StyleSheet") && !source.includes("useNxs")) {
    fail(`component or route uses StyleSheet without useNxs theme tokens in ${rel}`);
  }
}

const sourceFiles = walk("src").filter((path) => /\.(ts|tsx|js|jsx)$/.test(path));
for (const path of sourceFiles) {
  const source = read(path);
  if (/https?:\/\/[^\s"'\x60]+\.trycloudflare\.com/i.test(source)) {
    fail(`embedded permanent Quick Tunnel URL found in ${relative(".", path)}`);
  }
}

// Strip comments before geometry checks: a gate that a comment can satisfy is
// not a gate. Review demonstrated the old checks passing with hitSlop and the
// semantic minimums replaced by comments and a 24x24 Pressable.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Extract JSX elements by tag, tracking brace/paren/bracket depth so an arrow
 *  prop (`onPress={() => …}`) does not terminate the element early. */
function jsxElements(source, tag) {
  const elements = [];
  let index = 0;
  while ((index = source.indexOf(`<${tag}`, index)) !== -1) {
    const after = source[index + tag.length + 1];
    // `<PressableProps` is a type, not an element.
    if (after && /[A-Za-z0-9_]/.test(after)) {
      index += tag.length + 1;
      continue;
    }
    let cursor = index + tag.length + 1;
    let depth = 0;
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === "{" || char === "(" || char === "[") depth += 1;
      else if (char === "}" || char === ")" || char === "]") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    elements.push(source.slice(index, cursor + 1));
    index = cursor + 1;
  }
  return elements;
}

/** Resolve `name: { … }` style blocks from the same file. */
function styleBlock(source, name) {
  const match = source.match(new RegExp(`\\b${name}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  return match ? match[1] : null;
}

function hitSlopOf(element) {
  const match = element.match(/hitSlop\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|\d+)/);
  if (!match) return null;
  const numbers = [...match[1].matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  return numbers.length ? Math.min(...numbers) : null;
}

function declaredSize(block) {
  if (!block) return null;
  const sizes = [...block.matchAll(/\b(?:minHeight|minWidth|height|width):\s*(\d+)\b/g)].map((m) =>
    Number(m[1]),
  );
  // Check the smallest explicit axis so a wide-but-short control (e.g. 200x20)
  // cannot pass the 48pt floor via its horizontal length.
  return sizes.length ? Math.min(...sizes) : null;
}

const interactiveFiles = sourceFiles.filter((path) => codeOnly(read(path)).includes("<Pressable"));
if (interactiveFiles.length === 0) {
  fail("no interactive sources were found; refusing to pass vacuously");
}

for (const path of interactiveFiles) {
  const source = codeOnly(read(path));
  const elements = jsxElements(source, "Pressable");
  if (elements.length === 0) {
    fail(`Pressable references but no elements parsed in ${relative(".", path)}`);
  }

  for (const element of elements) {
    if (!/\baccessibilityRole\s*=/.test(element)) {
      fail(`custom Pressable lacks an explicit accessibilityRole in ${relative(".", path)}`);
    }
    const slop = hitSlopOf(element);
    if (slop === null || slop < 4) {
      fail(`custom Pressable lacks an explicit hitSlop >= 4 in ${relative(".", path)}`);
    }

    // Effective target = declared element size + 2 * hitSlop. A 24pt control with
    // 4pt slop is 32pt, not a 48pt target.
    const styleNames = [...element.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    for (const name of new Set(styleNames)) {
      const size = declaredSize(styleBlock(source, name));
      if (size === null) continue;
      if (size + 2 * slop < 48) {
        fail(
          `Pressable style ${name} is ${size}pt with ${slop}pt hitSlop (${size + 2 * slop}pt target), ` +
            `below the NXS 48 floor, in ${relative(".", path)}`,
        );
      }
    }
  }
}

if (!codeOnly(read("src/nxs/components/NxsButton.tsx")).includes("minHeight: tokens.touch.minimum")) {
  fail("NxsButton no longer consumes the semantic touch floor");
}
if (!codeOnly(read("src/nxs/components/NxsButton.tsx")).includes("minWidth: tokens.touch.minimum")) {
  fail("NxsButton no longer consumes the semantic touch floor");
}

for (const path of sourceFiles) {
  const source = read(path);
  if (/from\s+["'](?:@expo\/cli|zod)["']/.test(source)) {
    fail(`CLI-only vulnerable dependency imported into mobile runtime source: ${relative(".", path)}`);
  }
}

console.log(
  `NXS R2 foundation static checks passed: ${interactiveFiles.length} interactive source files audited.`,
);
