# TENGASELL-MOBILE-01 — Native Mobile Programme Charter

**Programme:** TENGASELL-MOBILE-01  
**Current unit:** MOB-01-R2 — NXS Foundation Convergence  
**Repository:** `kudzimusar/tengasell-auction`  
**Branch:** `feat/tengasell-mobile-01-product-foundation`  
**Frozen original programme parent:** `98a607c326ca4bcf24062c045d4eaa35762a3aa5`  
**MOB-01-R1 starting authority:** `cc707ebb5f52617de80aee4de2c343da8a18c173`  
**MOB-01-R2 accepted starting authority:** `00833452d9e9be6caa576b70e138718e7be46984`  
**Implementation candidate:** `1f11dd4c97ad654afa70d1e62676a7c6f475abd6`  
**Implementer / verifier segregation:** implementation evidence is not certification.

---

## 1. Governing authorities

Tengasell native mobile is governed by:

- **MSCS 1.0** — mobile release, experience, accessibility, IAM and related controls.
- **UDPCS 1.0** — cross-channel product experience and release expectations.
- **VAP 1.0** — exact-head custody, evidence depth, adversarial testing and independent certification.
- **NXS 1.0 — Native Experience System, Pilot Release** — governing UI/UX experience authority for Tengasell native presentation and interaction.

NXS is bounded to the experience layer. It does not silently alter product truth, authentication/authorization, data ownership, security policy, commercial rules, payments or backend contracts.

The version-controlled NXS project contract is:

`mobile/nxs-experience-manifest.yaml`

The NXS foundation and navigation evidence record is:

`docs/mobile/TENGASELL_MOBILE_01_NXS_FOUNDATION.md`

---

## 2. Canonical product authority — unchanged

The native client consumes only the accepted Tengasell commercial authority:

```text
TrailBase (Rust, :3001)              records + authentication/session
Socket.IO trade engine (:3002)       future bids/offers/live commercial operations
Gateway XTransformPort routing       shared transport convention
```

MOB-01 does **not** introduce:

- Prisma authority;
- a Next BFF commercial authority;
- local commercial-write authority;
- database/schema migrations;
- bidding, offers, checkout, Paynow, messaging, push, signing or store-release behavior.

All TrailBase traffic is routed through the gateway with `XTransformPort=3001`.

---

## 3. Technology and native architecture

**Implementation:** Expo / React Native / TypeScript, SDK 58.

MOB-01-R1 now uses real Expo Router custody:

```text
mobile/
  src/
    app/
      _layout.tsx
      index.tsx
      auth/login.tsx
      account/index.tsx
    auth/
      session-context.tsx
      session-storage.ts
    lib/
      trailbase.ts
      types.ts
      format.ts
    nxs/
      components/
      context/
      tokens/
```

The previous direct `mobile/App.tsx` / `mobile/index.ts` entry path was removed. `mobile/package.json` now uses:

```json
"main": "expo-router/entry"
```

CNG is preserved. No `ios/` or `android/` directories are in Git custody.

---

## 4. MOB-01 auth/session architecture — IAM-006 implementation

One native session authority exists in `src/auth/session-context.tsx`.

The runtime distinguishes:

- `booting`;
- `anonymous`;
- `authenticated`;
- `session-invalid`;
- `network-degraded`.

Implemented TrailBase lifecycle:

1. unauthenticated launch;
2. canonical login via `/api/auth/v1/login`;
3. encrypted native persistence through Expo SecureStore;
4. secure session restoration using the TrailBase refresh authority;
5. bearer attachment for authenticated canonical requests;
6. current-user identity derived from the canonical auth token subject;
7. canonical logout request plus immediate local privileged-state removal;
8. invalid/expired session fail-closed behavior;
9. protected-response generation guards so a response arriving after logout/session change is discarded;
10. no authenticated Demo fallback.

Sensitive bearer and refresh tokens are not stored in AsyncStorage and are not logged.

MFA entry is not implemented in MOB-01. If TrailBase reports an MFA-required login state, the client surfaces that limitation rather than bypassing it.

---

## 5. API client boundary

`mobile/src/lib/trailbase.ts` explicitly separates:

- public TrailBase requests;
- authenticated TrailBase requests;
- auth/session operations.

Configuration authority is:

`EXPO_PUBLIC_TENGASELL_API`

No permanent Cloudflare Quick Tunnel hostname is embedded in mobile source. Missing configuration produces an explicit configuration/degraded state.

---

## 6. NXS 1.0 foundation adopted during MOB-01-R1

The Tengasell mobile foundation is the NXS pilot surface.

Implemented NXS foundation controls include:

- version-pinned NXS experience manifest;
- semantic touch / spacing / radius / typography / surface / action / state / motion token namespaces;
- normal custom touch target floor of **48×48 logical units**;
- compact / regular / wide window resolution from actual viewport width;
- safe-area, font-scale, writing-direction, platform and color-scheme context;
- automatic semantic light/dark theme support;
- orientation unlocked for portrait/landscape verification;
- bounded wide-layout content widths rather than phone UI stretching indefinitely;
- native stack/back behavior through Expo Router;
- explicit loading, empty, partial, degraded and recoverable-error states;
- meaningful accessibility roles/labels/live updates;
- login form keyboard avoidance, scroll/reflow behavior and password reveal control;
- duplicate sign-in submission prevention and immediate loading acknowledgement;
- destructive Sign out semantics separated from primary/secondary actions;
- NXS navigation contract and verifier matrix.

For MOB-01, voice, haptics and expressive-energy effects are explicitly **off** rather than simulated. They can only be enabled by later authorized scope and NXS manifest change.

---

## 7. Configuration and version truth

```yaml
application_version: 0.1.0
package_version:     0.1.0
router_entry:        expo-router/entry
orientation:         default
theme:               automatic
canonical_api_env:   EXPO_PUBLIC_TENGASELL_API
TrailBase_route:     XTransformPort=3001
SocketIO_route:      XTransformPort=3002 (future commercial units; not implemented here)
```

Expo-resolved SDK dependencies include:

- `expo-router ~58.0.26`;
- `expo-secure-store ~58.0.2`;
- `expo-system-ui` resolved by `npx expo install`;
- `react-native-safe-area-context ~5.10.1`;
- `react-native-screens ~4.30.0`.

No package version above was manually guessed for the SDK-specific Expo modules.

---

## 8. Candidate Authority Record — VAP §6 / MOB-01-R1

```text
repository:                kudzimusar/tengasell-auction
branch:                    feat/tengasell-mobile-01-product-foundation
original_programme_parent: 98a607c326ca4bcf24062c045d4eaa35762a3aa5
mob01_r1_starting_sha:     cc707ebb5f52617de80aee4de2c343da8a18c173
implementation_candidate:  1f11dd4c97ad654afa70d1e62676a7c6f475abd6
build_id:                  not produced
deployment_id:             not applicable
database_migration_state:  unchanged
application_version:       0.1.0
api_contract:              /api/auth/v1 + /api/records/v1
nxs_version:               1.0 Pilot Release
verified_at:               reserved for independent verifier
```

The documentation commit that contains this record is evidence-only and may be later than the implementation candidate. Exact branch HEAD at handoff must therefore be reported separately by the specialist.

---

## 9. Implementer V1 / V2 evidence

Exact implementation candidate:

`1f11dd4c97ad654afa70d1e62676a7c6f475abd6`

GitHub Actions run:

`40465351163`

Results:

| Gate | Result |
| --- | --- |
| NXS foundation static review | **PASS** |
| `npx expo-doctor` | **PASS — 20/20 checks** |
| `npx expo lint` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npx expo export --platform android` | **PASS — Exported: dist** |
| `npx expo export --platform ios` | **PASS — Exported: dist** |
| `git diff --check` | **PASS** |
| `git status --short` clean assertion | **PASS** |

This is implementer evidence only. It does not satisfy V3–V5 or NXS physical certification.

---

## 10. Independent verifier matrix

### VAP IAM-006 positive

- anonymous app launch;
- successful login;
- authenticated profile/API request;
- restart with valid stored refresh session;
- logout;
- post-logout protected state absent.

### VAP IAM-006 negative

- wrong credentials;
- unreachable canonical authority;
- invalid/expired auth or refresh token;
- malformed auth/refresh response;
- SecureStore/session restoration failure.

### VAP IAM-006 adversarial

- stale protected response after logout;
- protected request during boot/session restoration;
- repeated login/logout cycles;
- restart after server-side token invalidation;
- network loss during session recovery.

### NXS foundation verification

- compact phone + 200% text + keyboard visible;
- expanded tablet + landscape;
- expanded pseudolocale and RTL stress;
- screen reader during loading/degraded state;
- light/dark semantic themes and contrast;
- one-handed touch/reach review;
- native back/deep-link/session-restoration behavior on iOS and Android;
- slow-network repeated-tap duplicate-submission test;
- representative performance/stability observation.

No V3–V5 or NXS CERTIFIED claim is made by the implementer.

---

## 11. Known limitations

- No physical iOS/Android device evidence has been produced in this implementation unit.
- VoiceOver/TalkBack, 200% text, pseudolocalization/RTL, contrast and orientation/device adaptation require independent verification.
- MFA entry is not implemented.
- Haptics and voice are disabled for MOB-01.
- No EAS signed build or store deployment exists.
- A stable store-facing API hostname remains an owner/release prerequisite.
- MOB-02+ commercial/product expansion remains unauthorized.

---

## 12. Implementation Completion Manifest — VAP §13

- **Project / work unit:** TENGASELL-MOBILE-01 · MOB-01-R1
- **Governing requirements:** IAM-006; EXP-006/007/008; ACC-001/009/010; NXS 1.0 foundation rules; canonical authority constraint.
- **Starting SHA:** `cc707ebb5f52617de80aee4de2c343da8a18c173`
- **Implementation candidate SHA:** `1f11dd4c97ad654afa70d1e62676a7c6f475abd6`
- **Schema / migrations:** none
- **Production access:** none
- **LOCAL01 certification workspace:** untouched
- **Implementation state:** routed Expo native shell + canonical auth/session + SecureStore + authenticated request support + NXS foundation.
- **Implementer gates:** all required static/build/export gates passed at the exact implementation candidate.
- **Certification state:** pending independent VAP/NXS verification.

> **STATUS: READY_FOR_INDEPENDENT_VERIFICATION** — this is an implementation readiness declaration, not certification.


---

## 13. MOB-01-R2 — NXS foundation convergence

**Moderator disposition:** `REMEDIATE — BOUNDED NXS FOUNDATION DEFECTS ONLY`

R2 preserves the accepted R1 Router, TrailBase, SecureStore, NXS token and canonical-authority architecture. It remediates only localization/pseudolocalization, runtime environment completeness, static enforcement and dependency-security evidence.

### R2 custody

```text
r2_starting_sha:           00833452d9e9be6caa576b70e138718e7be46984
r2_source_candidate:       24cfe442baedb479b83c7812a7fb5b284f315814
branch:                    feat/tengasell-mobile-01-product-foundation
schema_migrations:         none
production_access:         none
local01_workspace:         untouched
```

The final handoff head may contain evidence-only documentation after the source candidate. It is reported separately in the specialist return and must independently pass the same automated gates.

---

## 14. R2 localization and pseudolocalization authority

MOB-01 user-facing route/component strings are externalized through:

`mobile/src/nxs/localization/catalog.ts`

The current launch locale remains English.

Development/certification stress modes are:

```bash
EXPO_PUBLIC_NXS_LOCALE=en-XA
EXPO_PUBLIC_NXS_LOCALE=ar-XB
```

`en-XA` expands/accentuates resource text. `ar-XB` applies the same expansion plus RTL isolation and NXS effective RTL layout direction.

Resource templates are pseudolocalized **before** placeholder interpolation. Dynamic domain values therefore remain literal, including:

- auction/item titles;
- category names;
- usernames;
- prices and bid counts;
- TrailBase user IDs;
- unknown backend/domain error text.

Known Tengasell/TrailBase client messages are mapped to resource keys. Unknown server messages are preserved rather than mechanically transformed.

`expo-localization ~58.0.5` supplies the native device locale/language/direction signal. The app's system-declared supported launch locale remains `en`; pseudolocales are explicit development/certification overrides rather than fake production languages.

---

## 15. R2 NXSContext environment truth

The R2 environment resolver exposes:

```text
platform
viewportWidth / viewportHeight
orientation
windowClass
fontScale
locale / language
deviceLocale / deviceLanguage
writingDirection / deviceWritingDirection
safeArea
keyboardVisible
colorScheme
reduceMotion
screenReader
contrastPreference
reduceTransparency
networkState
networkType
```

Truth policy:

- orientation derives from the current window, not a device model;
- locale signals come from Expo Localization;
- keyboard visibility comes from React Native keyboard events;
- reduce motion and screen-reader state come from React Native AccessibilityInfo queries/events;
- Android high-text-contrast and iOS darker-system-colors are normalized into `contrastPreference`;
- reduced-transparency is exposed on iOS and remains `unknown` where no reliable equivalent is available;
- NetInfo resolves online / offline / degraded / unknown without inventing reachability;
- unavailable/unresolved values remain `unknown`.

The provider does not claim that platform-specific accessibility settings are semantically identical.

---

## 16. R2 static enforcement and touch audit

`mobile/scripts/verify-nxs-foundation.mjs` now enforces:

- NXS manifest exists and pins 1.0;
- iOS and Android remain declared;
- strict certification remains declared;
- pseudolocalization remains required;
- `en-XA` and `ar-XB` mechanisms remain declared;
- NXS 48×48 touch floor remains encoded;
- `expo-router/entry` remains application entry;
- adaptive orientation remains enabled;
- automatic theme remains enabled;
- Expo Router / SecureStore / Localization config remains present;
- SecureStore remains credential persistence authority;
- legacy `App.tsx` / `index.ts` entries remain absent;
- permanent `trycloudflare.com` URLs remain absent from runtime source;
- navigation-contract evidence remains present;
- localization authority remains consumed by every MOB-01 route;
- hard-coded custom-control/accessibility labels are rejected in route files;
- numeric custom interactive geometry below 48 is rejected;
- app-source imports of `@expo/cli` or `zod` are rejected.

R2 workflow run `40469054727` reports:

`NXS R2 foundation static checks passed: 2 interactive source files audited.`

This is a bounded source audit, not physical touch certification.

---

## 17. R2 dependency-security triage

Audit evidence: run `40468330471`, plus repeat snapshot in run `40469054727`.

The three npm high findings resolve to the known Expo tooling advisory chain:

```text
expo 58.0.19
  -> @expo/cli 58.1.15
      -> zod 3.25.76
          GHSA-mrhx-c7xc-m3w5
          affected < 4.6.6
```

No `mobile/src` file imports `@expo/cli` or `zod`. Native runtime exploit reachability is therefore not demonstrated by current evidence; Node build/development-tooling exposure remains.

The installed root Zod instance is also deduped into other Node tooling paths, reinforcing that dependency placement in npm's production graph does not by itself prove native-runtime reachability.

`npm audit` suggests `expo@54.0.38` as a force-fix target and marks the change SemVer-major. That would violate the accepted SDK-58 / React Native 0.88 authority. No force-fix was applied.

R2 disposition:

`KNOWN_EXPO_TOOLING_ADVISORY — MONITOR_AND_PATCH_WITHIN_SDK_58`

See `docs/mobile/TENGASELL_MOBILE_01_R2_DEPENDENCY_SECURITY.md`.

---

## 18. R2 implementer gates — source candidate

Exact source candidate:

`24cfe442baedb479b83c7812a7fb5b284f315814`

GitHub Actions run:

`40469054727`

| Gate | Result |
| --- | --- |
| `npm ci` | **PASS** |
| NXS R2 foundation static review | **PASS — 2 interactive source files audited** |
| Dependency-security snapshot / known-chain assertion | **PASS** |
| `npx expo-doctor` | **PASS — 20/20 checks** |
| `npx expo lint` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npx expo export --platform android` | **PASS — Exported: dist** |
| `npx expo export --platform ios` | **PASS — Exported: dist** |
| `git diff --check` | **PASS** |
| clean `git status --short` assertion | **PASS** |

---

## 19. R2 limitations reserved for independent NXS verification

Not self-certified in this unit:

- physical 48×48 thumb/reach behavior;
- VoiceOver/TalkBack task completion;
- 200% text reflow;
- keyboard behavior on representative devices;
- actual `en-XA` and `ar-XB` visual captures;
- native back-direction behavior under true platform RTL;
- compact / tall / landscape / expanded tablet physical adaptation;
- light/dark contrast measurements;
- slow-network repeated-tap behavior on device;
- performance/frame stability;
- future representative-screen topology transformation.

MOB-02 remains unauthorized.

> **MOB-01-R2 IMPLEMENTER STATE: READY_FOR_NXS_INDEPENDENT_VERIFICATION** — implementation readiness only; no NXS certification or numerical score is issued here.
