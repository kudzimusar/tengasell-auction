# TENGASELL-MOBILE-01 — Native Mobile Programme Charter

**Programme:** TENGASELL-MOBILE-01  
**Current unit:** MOB-01-R1 — Native Foundation Closure  
**Repository:** `kudzimusar/tengasell-auction`  
**Branch:** `feat/tengasell-mobile-01-product-foundation`  
**Frozen original programme parent:** `98a607c326ca4bcf24062c045d4eaa35762a3aa5`  
**MOB-01-R1 starting authority:** `cc707ebb5f52617de80aee4de2c343da8a18c173`  
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
