# TENGASELL-MOBILE-UX-PARITY-01-R2 — Source Publication, Truthful Product Intelligence & Physical UAT Closure

> [!IMPORTANT]
> **Controlling Authority & Custody:**  
> - **Repository:** `kudzimusar/tengasell-auction`  
> - **Authorized Parent Baseline:** `feat/tengasell-mobile-mob03-bidding-and-release` (PR #9 @ `9bd369ad7000c7564195c1249d75759064706068`)  
> - **Draft Integration Branch:** `feat/tengasell-mobile-ux-parity-01-draft`  
> - **Published Draft Pull Request:** `TENGASELL-MOBILE-UX-PARITY-01: UAT source alignment and native convergence`  
> - **Target Simulator:** `iPhone 18 Pro` (`FC17FF48-A93F-48B3-9544-72356B1529B5`, iOS 27.0, 390pt logical width)  
> - **Active Gateway:** `http://127.0.0.1:19080` (proxying to TrailBase `:19001` via `?XTransformPort=3001` and trade-engine `:19002` via `?XTransformPort=3002`)  
> - **Governance Posture:** Isolated draft PR only; **no merge to main, no production deployment, no uncertified feature release**.

---

## 1. Mission A — Build Provenance & Root-Cause Diagnosis

### 1.1 Source & Build Provenance
| Provenance Dimension | Live UAT Value | Evidence / Verification Method |
|---|---|---|
| **Git Repository** | `kudzimusar/tengasell-auction` | Local checkout in AutoClaw workspace |
| **Base Commit SHA** | `9bd369ad7000c7564195c1249d75759064706068` | Remote `origin/feat/tengasell-mobile-mob03-bidding-and-release` |
| **Draft Commit SHA** | `564680b0b9852acd0243fd2767af0ce5adb16301` + R2 updates | `feat/tengasell-mobile-ux-parity-01-draft` |
| **Installed Binary** | `com.tengasell.app` (`TengaSell.app`) | Simulator bundle at `.../5A6166BD-F552-475D-92F9-31F88A0FAD09/TengaSell.app` |
| **Build Machine / OS** | macOS 26A428, Xcode 27A266a | `plutil -p Info.plist` inspection |
| **Build Timestamp** | `2026-11-14T05:01:00Z` | Binary modification timestamp |
| **JavaScript Runtime** | Hermes JSI / Expo SDK 58 / React Native 0.88 (iOS) | Metro bundler on port 8081 (`RCTMetroPort: 8081`) |
| **Backend Target** | `http://127.0.0.1:19080` | `EXPO_PUBLIC_TENGASELL_API` through `gateway.mjs` |

### 1.2 Root-Cause Diagnosis of Owner's Observation
The Owner's iPhone UAT showed the existing basic MOB-02/MOB-03 item-detail interface without the web's newer capabilities due to two distinct compounding factors:

1. **Local Gateway Misalignment (Port 8080 vs 19080):**  
   The development build command previously invoked Metro with `EXPO_PUBLIC_TENGASELL_API=http://localhost:8080`. On macOS developer workstations, port 8080 is bound by Docker Desktop (`com.docker.backend`). As a consequence, requests to fetch auction records failed or timed out against Docker, preventing data schemas from resolving. Running against the authorized Tengasell gateway on `http://127.0.0.1:19080` restores immediate end-to-end communication with TrailBase (`:19001`) and the trade engine (`:19002`).
2. **Web/Native Architectural Divergence:**  
   The native mobile repository was branched and implemented during the `MOB-01`, `MOB-02`, and `MOB-03` cycles (PR #6, PR #7, PR #9). In parallel, web engineering completed:
   - **PR #14 (`PI-01D`):** Vehicle Product Intelligence, intake forms, U17–U23 migrations, and reserve price disclosure.
   - **PR #15 (`PI-01E`):** Structured Discovery, FTS5 projections, dynamic category facets, and side-by-side comparison modal.
   - **PR #17 (`UX01-R1`):** Unified Timed Auctions + Live Event Discovery, dual gateways, `AuctionHub`, and authoritative `HammerClock`.
   None of these web-specific components had native React Native counterparts or schema models in `mobile/src/`.

### 1.3 Development-Only About & Diagnostics View
To guarantee complete build transparency without leaking sensitive tokens or credentials, [`AboutDiagnosticsCard.tsx`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/components/AboutDiagnosticsCard.tsx) was created and embedded into the **You / Account** screen (`AccountContent.tsx`). It dynamically displays:
- Application ID (`com.tengasell.app`) and Version `0.1.0 (1)`.
- Live Commit SHA (`9bd369ad70...`) and Active Source Branch.
- Build Timestamp and Hermes runtime engine information (`Expo SDK 58 / Hermes / ios`).
- Target API Gateway (`http://127.0.0.1:19080`).
- Docker Port 8080 conflict warning banner if gateway is incorrectly pointed to 8080.
- Multi-platform network guidance: iOS Simulator (`127.0.0.1`), Android Emulator (`10.0.2.2`), Physical Device (`LAN IP`).
- Real-time Web/Native Feature Parity status badges (`CERTIFIED`, `PREVIEW`, `BLOCKED`).

---

## 2. Mission B — Web/Native Feature Divergence Parity Matrix

| Feature Area | Controlling PR | Web Implementation State | Mobile Implementation State | Parity Gap & Certification Dependency |
|---|---|---|---|---|
| **Trade Engine Security & Fail-Closed Auth** | **PR #12** (`SEC-01`) | Merged in draft; BFF token verification, SQLite token revocation (`tgs_revocations.db`), clientRequestId. | **100% Certified Parity:** `session-orchestrator.ts`, `logout-transaction.ts`, Socket.IO `auth:revoked` listener, 130 passing unit tests. | None. Mobile client fully implements and verifies PR #12 requirements. |
| **Reserve Price Status Disclosure** | **PR #14** (`PI-01D`) | Discloses `No Reserve`, `Reserve Applies`, or `Upset Price Applies` based on canonical `reserve_disclosure`. | **100% Truthful Canonical Preview:** `VehicleProductIntelligenceCard` strictly reads `reserve_disclosure`. Never infers "No Reserve" from null reserve_price, and never displays private reserve amount. | Non-blocking preview on draft branch. Depends on PR #14 backend certification. |
| **Vehicle Product Intelligence (Specs & Inspection)** | **PR #14** (`PI-01D`) | U17–U23 TrailBase migrations; vehicle spec grid, VIN decoding, inspection checklist modal. | **Truthful Canonical Preview Implemented:** `VehicleProductIntelligenceCard` displays canonical public projection (`make`, `model`, `year`, `mileage`, `transmission`, `fuel_type`, `body_type`, `odometer_source`, `vin_classification`). Zero title/regex heuristics. | **Omitted / Blocked:** Full inspection PDF and raw VIN decoding routes (`/api/pi/vehicles/*`) require PR #14 backend merge. |
| **Seller Vehicle Intake Form** | **PR #14** (`PI-01D`) | Multi-step seller listing wizard with vehicle photo uploads and condition checklist. | **Missing on Native (Web-Only):** Mobile currently only supports browsing, searching, and bidding (buyer focus). | Seller intake deferred to future mobile seller release (MOB-04+). |
| **Intelligent Search & Recommendations** | **TENGASELL-REC-01** | Content-based recommendation algorithm with seller diversity caps (max 2/seller). | **100% Certified Parity:** Native `recommend.ts`, `SearchHeader.tsx`, dynamic stem suggestions (`suggestQueries`), sort ranking (`rankSearchResults`). | Certified under `MOB-VIS-01-R1`. |
| **Structured Discovery & FTS5 Facets** | **PR #15** (`PI-01E`) | FTS5 projection (`U24`), dynamic category facets (`/api/pi/categories/{key}/filters`). | **Partial Native Support:** Client-side category filtering and query suggestions; no server-side faceted filter drawer. | **Incompatible API:** Mobile calls TrailBase `/api/records/v1/auctions` directly. `/api/pi/search` route requires web Next.js BFF proxy. |
| **Side-by-Side Product Comparison** | **PR #15** (`PI-01E`) | Compare dialog (`compare-dialog.tsx`) consuming `/api/pi/compare`. | **Missing on Native:** No native comparison sheet or floating compare tray. | Dependent on PR #15 merge and dedicated native bottom sheet implementation. |
| **Live Event Floor & Dual Gateways** | **PR #17** (`UX01-R1`) | Dual gateways (Timed vs Live Stream Floor), `AuctionHub`, authoritative LIVE invariants. | **Partial Native Support:** Dedicated `Live` tab (`/live`) filterable by Ending Soon; timed Socket.IO bidding active. | **Missing on Native:** Live video/audio floor streaming, synchronous clerk `HammerClock` state transitions. |

---

## 3. Mission C — Native Convergence Implementation Architecture

All native capabilities have been developed on an **isolated draft integration branch** (`feat/tengasell-mobile-ux-parity-01-draft`), strictly preserving existing guarantees:
1. **Zero Raw Hex Colors / Strict NXS Compliance:** All UI elements consume `theme.*` tokens (`theme.surface.canvas`, `theme.border.warning`, `theme.state.success`, etc.) and localized string catalog keys (`catalog.ts`).
2. **Truthful Reserve Price Disclosure:** Strictly consumes canonical `reserve_disclosure` enum (`NO_RESERVE`, `RESERVE_APPLIES`, `UPSET_APPLIES`, `UNSPECIFIED`). Never infers "No Reserve" merely because `reserve_price` is null or absent. Never renders private `reserve_price` amount.
3. **Truthful Vehicle Specifications:** Strictly checks schema `category` and `asset_kind`. Zero title/regex heuristics. Renders canonical public projection fields (`make`, `model`, `year`, `mileage`, `transmission`, `fuel_type`, `body_type`) with explicit source (`SELLER_DECLARED`) and verification status (`UNVERIFIED` / `VERIFIED`).
4. **Privacy Protection:** Raw VIN, chassis number, engine number, and registration numbers are strictly excluded from native rendering; masked classification (`Recorded (Masked for Privacy)`) is displayed.
5. **Fail-Soft Merchandising Gating:** Features dependent on uncertified PRs (#14, #15, #17) are tagged with `[PREVIEW: PR #14 PRODUCT INTELLIGENCE]` and fail soft to standard merchandise notices on non-vehicle lots.
6. **Socket.IO Bidding Custody:** Mobile maintains authoritative live bidding exclusivity via the trade engine on port 19002; no direct database writes to `bids` or `auctions`.

### Modified Source Files:
- [`mobile/src/lib/types.ts`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/lib/types.ts): Added canonical `ReserveDisclosure`, `VehiclePublicProjection`, `FactSourceClass`, and `FactVerificationState`.
- [`mobile/src/lib/build-info.ts`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/lib/build-info.ts): Clean build provenance metadata, Docker port 8080 conflict detection, and network target guidance.
- [`mobile/src/components/AboutDiagnosticsCard.tsx`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/components/AboutDiagnosticsCard.tsx): Diagnostics card with branch, commit, timestamp, runtime, Docker warning, and parity register.
- [`mobile/src/components/VehicleProductIntelligenceCard.tsx`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/components/VehicleProductIntelligenceCard.tsx): PR #14 truthful reserve disclosure and vehicle specifications card with fail-soft non-vehicle handling.
- [`mobile/src/components/AccountContent.tsx`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/components/AccountContent.tsx): Integrated diagnostics view in both guest and authenticated account states.
- [`mobile/src/app/item/[id].tsx`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/app/item/%5Bid%5D.tsx): Integrated vehicle product intelligence, reserve disclosure preview, and smooth auto-scroll to intelligence card.
- [`mobile/src/nxs/localization/catalog.ts`](file:///Users/shadreckmusarurwa/Library/Application%20Support/AutoClaw-oversea-official/accounts/b360afae874c11bf2ed952e82913d1bad7e18b325eb50b2c3feff360efbdb5d0/projects/New%20project/tengasell-auction/mobile/src/nxs/localization/catalog.ts): Localized string resources for diagnostics, truthful reserve disclosures, and vehicle specifications.

---

## 4. Mission D — Physical Simulator UAT & Visual Evidence

Interactive verification executed against `iPhone 18 Pro` (`iOS 27.0`, 390pt logical width):

| Screen / Step | Captured Artifact | Key Verification Findings | Status |
|---|---|---|---|
| **0. Owner Baseline** | [`ios_parity_00_owner_baseline.png`](file:///Users/shadreckmusarurwa/.gemini/antigravity/brain/0952c05d-4c13-48ed-97b1-fb837eebb805/screenshots/ios_parity_00_owner_baseline.png) | Pre-convergence screen showing unaugmented MOB-02/MOB-03 lot without diagnostics or reserve status disclosure. | **RECORDED** |
| **1. Connected Home** | [`ios_parity_01_home_connected.png`](file:///Users/shadreckmusarurwa/.gemini/antigravity/brain/0952c05d-4c13-48ed-97b1-fb837eebb805/screenshots/ios_parity_01_home_connected.png) | Connected to live gateway (`● Live auctions connected`), compact SearchHeader, recommendation carousel, and 4 bottom tabs. | **VERIFIED** |
| **2. Build Diagnostics** | [`ios_parity_02_about_diagnostics.png`](file:///Users/shadreckmusarurwa/.gemini/antigravity/brain/0952c05d-4c13-48ed-97b1-fb837eebb805/screenshots/ios_parity_02_about_diagnostics.png) | Displays commit SHA (`9bd369ad70...`), branch `feat/tengasell-mobile-ux-parity-01-draft`, timestamp, runtime, gateway (`http://127.0.0.1:19080`), network target guidance, and feature parity register with `CERTIFIED` and `PREVIEW` status badges. | **VERIFIED** |
| **3. Item Detail with PI Preview (Scrolled)** | [`ios_parity_04_item_pi_scrolled.png`](file:///Users/shadreckmusarurwa/.gemini/antigravity/brain/0952c05d-4c13-48ed-97b1-fb837eebb805/screenshots/ios_parity_04_item_pi_scrolled.png) | Live lot 9002 scrolled down to Product Intelligence card: displays `[PREVIEW: PR #14 PRODUCT INTELLIGENCE]`, `Reserve Disclosure: [Reserve Status: Not Disclosed]`, fail-soft non-vehicle notice, and truthful protection disclaimer. | **VERIFIED** |
| **4. Vehicle Specifications Card (Scrolled)** | [`ios_parity_05_item_vehicle_scrolled.png`](file:///Users/shadreckmusarurwa/.gemini/antigravity/brain/0952c05d-4c13-48ed-97b1-fb837eebb805/screenshots/ios_parity_05_item_vehicle_scrolled.png) | Vehicle lot with canonical public projection: displays `[Reserve Applies]` badge, 8-cell spec grid (`Make & Model`, `Year`, `Mileage`, `Transmission`, `Fuel Type`, `Body Type`, `Data Source`, `VIN Classification`), and `Seller-Declared Information (Unverified)` badge. | **VERIFIED** |
| **5. Android Emulator & Physical Hardware** | — | Android emulator and physical mobile hardware testing are unavailable on this local workstation environment. | **BLOCKED** |

---

## 5. Software & Quality Gates Posture

All verification gates on `feat/tengasell-mobile-ux-parity-01-draft` executed and exited `0`:
- **Unit Test Suite:** `130/130` PASS (`node --test tests/*.test.mjs`, duration ~1.4s).
- **Linter:** `expo lint` (`npm run lint`): **0 errors, 0 warnings**.
- **Typecheck:** `tsc --noEmit` (`npm run typecheck`): **0 errors**.
- **NXS Foundation Check:** `11 interactive source files audited, 0 violations`.
- **Release-Secret Scan:** `69 files scanned, 0 secrets detected`.

---

## 6. Corrected Reproducible Build Procedure

To launch and run the mobile simulator candidate with exact backend connectivity:

```bash
# 1. Switch to draft integration branch
git checkout feat/tengasell-mobile-ux-parity-01-draft

# 2. Start disposable backend services (if not already running)
# TrailBase (:19001) and trade-engine (:19002)

# 3. Start the API gateway with port remapping
node scripts/gateway.mjs --port 19080 --app 19000 --trailbase 19001 --trade 19002 &

# 4. Start Metro bundler with correct gateway target
cd mobile
export EXPO_PUBLIC_TENGASELL_API=http://127.0.0.1:19080
npx expo start --port 8081 --clear

# 5. Launch native application on iOS Simulator
xcrun simctl openurl FC17FF48-A93F-48B3-9544-72356B1529B5 "tengasell:///you"
```

---

## 7. Prioritized Implementation Plan for Full Parity

| Phase | Scope | Dependencies | Status |
|---|---|---|---|
| **Phase 1: Diagnostics & Provenance** | Deploy `AboutDiagnosticsCard`, Docker 8080 conflict warning, and live build provenance to eliminate UAT ambiguity. | None | **Delivered** |
| **Phase 2: Truthful Product Intelligence Preview** | Canonical reserve disclosure pills, truthful vehicle specification projection grid, and verification badges on native lot pages. | PR #14 draft | **Delivered** |
| **Phase 3: Structured Discovery & Facets** | Build native category facet filter drawer (mileage, transmission, fuel, price range) in `search.tsx`. | PR #15 merge | 1 sprint |
| **Phase 4: Side-by-Side Comparison** | Implement native 2-item vehicle comparison modal (`compare-sheet.tsx`). | PR #15 merge | 1 sprint |
| **Phase 5: Live Event Discovery** | Integrate dual-gateway switcher (Timed vs Live Event Floor) and `HammerClock` animation. | PR #17 merge | 2 sprints |
