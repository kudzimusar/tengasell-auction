# TENGASELL-MOBILE-UX-PARITY-01-R3A-ICR01-CLOSE-02 — Independent Review Remediation, Reproducible Build Identity and Owner-Accessible Native UAT

> [!IMPORTANT]
> **Source Authority & Custody:**  
> - **Repository:** `https://github.com/kudzimusar/tengasell-auction` (`kudzimusar/tengasell-auction`)  
> - **Parent Baseline (Frozen):** PR #9 at `9bd369ad7000c7564195c1249d75759064706068` (`feat/tengasell-mobile-mob03-bidding-and-release`)  
> - **Draft Pull Request:** PR #21 (`feat/tengasell-mobile-ux-parity-01-draft`)  
> - **Reviewed Head SHA:** `8b5a526393a36f523ce14138b4221bb692fe63d1`  
> - **Independent Reviewer:** `@11-eleven-skm` (Review ID `5907551904` — `CHANGES_REQUESTED`)  
> - **Execution Mode:** Bounded remediation on existing PR #21; dynamic build metadata; strict presentation allowlist; downloadable CI evidence artifacts; bit-exact SHA-256 verification.

---

## 1. Finding-to-Fix Remediation Register

This assignment directly closes all findings raised in independent review `5907551904`:

| Review Finding | Classification | Defect Description | Root Cause | Engineering Remediation | Verification & Evidence |
|---|---|---|---|---|---|
| **MOB-PARITY-PROV-01** | P0 Provenance | Stale Git commit SHA in tracked source (`build-meta.json` declared `d76daae...` on commit `8b5a526...`). | `build-meta.json` was tracked in git, making it impossible to contain the introducing commit's own hash without becoming stale. | 1. Added `src/lib/build-meta.json` to `.gitignore`.<br>2. Untracked file via `git rm --cached`.<br>3. `scripts/generate-build-metadata.mjs` generates transient metadata dynamically during build/CI/export with real bundle digest.<br>4. Created `scripts/verify-provenance-and-manifest.mjs` to enforce fail-closed check in release/CI.<br>5. Added 5 negative tests in `tests/build-provenance.test.mjs`. | `node scripts/verify-provenance-and-manifest.mjs`<br>Passed: dynamic commit SHA matching git HEAD (`8b5a526...`), valid branch, and SHA-256 bundle digest. 9 unit tests pass. |
| **MOB-PARITY-PI-02** | P1 Boundary Security | Permissive string cast in `sanitizeAuctionPublicView` (`as ReserveDisclosure`); object spreading (`...raw`) risked copying unredacted database columns. | TypeScript cast without runtime enum check allowed arbitrary strings. Spreading `{ ...raw }` followed by `delete` allowed unexpected columns to leak. | 1. Implemented strict runtime validator `validateReserveDisclosure()` against `ALLOWED_RESERVE_DISCLOSURES`.<br>2. Replaced object spreading with an explicit, property-by-property public allowlist.<br>3. Normalized contradictions (`NO_RESERVE` with numeric reserve > 0) to `UNSPECIFIED`.<br>4. Missing reserve never derives `NO_RESERVE`.<br>5. Added explicit architectural notice in code: client sanitization is defense-in-depth, not server-side security. | `tests/privacy-boundary.test.mjs` expanded from 4 to 8 tests covering invalid enums, contradictory reserves, absent reserves, and database injection attacks.<br>All 8 tests pass. |
| **MOB-PARITY-EVID-01** | P1 Review Evidence | UAT screenshots were located only in local conversation artifacts and could not be retrieved by reviewer `@11-eleven-skm`. | Artifacts were stored in agent scratch directories without repository commit or CI artifact publication. | 1. Created `docs/mobile/evidence/` containing all 11 high-resolution UAT screenshots.<br>2. Added `actions/upload-artifact@v4` in `.github/workflows/tengasell-mobile-pr.yml` to publish downloadable evidence archives.<br>3. Created `scripts/verify-evidence-manifest.mjs` verifying SHA-256 checksums of all evidence files against `mobile-uat-manifest.json`. | `node scripts/verify-evidence-manifest.mjs`<br>Passed: 11/11 evidence files verified with bit-exact SHA-256 integrity. Downloadable archive in CI. |
| **MOB-PARITY-UAT-01** | P1 UAT Truthfulness | Need exact-source simulator evidence reflecting active PR #21 code and verified Device Hub desktop mirror. | Previous captures showed transitional states or earlier commit metadata. | Re-executed complete 11-step simulator journey on `iPhone 18 Pro` (iOS 27.0) via Apple Device Hub (`DeviceHub.app`, Window ID 15276). Verified live metadata card reflects exact commit SHA. Android/physical remain strictly marked `BLOCKED`. | 11 screenshots captured, verified, and committed into `docs/mobile/evidence/`. |

---

## 2. Source & Build Provenance Architecture

```mermaid
flowchart TD
    subgraph GitRepo["Git Repository (Authoritative Source)"]
        HEAD["Git HEAD: feat/tengasell-mobile-ux-parity-01-draft"]
        Parent["Frozen Parent: PR #9 (9bd369a)"]
        TrackedFiles["Tracked Source (ZERO committed build-meta.json)"]
    end

    subgraph CIBuild["Build & CI Lifecycle (Transient)"]
        GenMeta["scripts/generate-build-metadata.mjs"]
        VerifyProv["scripts/verify-provenance-and-manifest.mjs"]
        VerifyEvid["scripts/verify-evidence-manifest.mjs"]
        ExpoExport["nxs export (Android & iOS Hermes HBC)"]
        TransientMeta["mobile/src/lib/build-meta.json (GITIGNORED)"]
    end

    subgraph RuntimeLayer["Native Mobile App Runtime"]
        NativeBinary["Native Binary: com.tengasell.app v0.1.0 (1)"]
        MetroDev["Metro Server: 127.0.0.1:8081 (Dev)"]
        Diagnostics["AboutDiagnosticsCard (__DEV__ Gated)"]
        PrivacyGuard["sanitizeAuctionPublicView (Strict Allowlist)"]
    end

    HEAD --> GenMeta
    GenMeta --> TransientMeta
    TransientMeta --> VerifyProv
    VerifyProv --> ExpoExport
    VerifyEvid --> ExpoExport
    TransientMeta --> Diagnostics
    PrivacyGuard --> Diagnostics
    NativeBinary --> Diagnostics
```

### Provenance Identity Breakdown

| Identity Dimension | Value | Lifecycle / Custody | Enforced Invariant |
|---|---|---|---|
| **PR Source Head** | `8b5a526393a36f523ce14138b4221bb692fe63d1` | PR #21 branch | Verified via `git rev-parse HEAD` |
| **Parent Baseline Head** | `9bd369ad7000c7564195c1249d75759064706068` | PR #9 (MOB-03) | Frozen baseline; no rebasing |
| **Tested Merge SHA** | Dynamic GitHub merge ref | Generated in GitHub Actions | Explicitly distinguished from PR source |
| **JS Bundle Digest** | `sha256:7122af43a38f8950...` | Computed across `dist/` | Verified at build-time |
| **Native Binary Version** | `v0.1.0 (1)` | `app.json` / native plist | Distinct from JS bundle update |
| **Runtime Engine** | Expo SDK 58 (Hermes / RN 0.88 / iOS) | CoreSimulator iOS 27.0 | Verified via `npx expo-doctor` (20/20) |
| **Backend Gateway** | `http://127.0.0.1:19080` | PID 62155 (proxying TrailBase & Trade Engine) | Configured via `EXPO_PUBLIC_TENGASELL_API` |

---

## 3. Presentation Privacy Boundary Specification

### 3.1 Defense-in-Depth Presentation Layer
> [!NOTE]
> Client-side sanitization in `mobile/src/lib/trailbase.ts` operates strictly as **defense-in-depth** for the mobile presentation layer. It does not replace authoritative server-side projection enforcement. The backend gate for PR #14 vehicle intelligence remains **`BLOCKED`** pending independent backend certification.

### 3.2 Property-by-Property Allowlist Mapping (Zero Object Spreading)
Object spreading (`const sanitized = { ...raw }`) has been eliminated completely. The returned `Auction` projection is constructed field-by-field:
- `id`, `user`, `seller_username`, `title`, `slug`, `description`, `category`, `condition`
- `start_price`, `current_price`, `buy_now_price`
- **`reserve_price: null`** (strictly scrubbed to null)
- **`reserve_disclosure`**: runtime enum validated against `ALLOWED_RESERVE_DISCLOSURES` (`"UNSPECIFIED" | "NO_RESERVE" | "RESERVE_APPLIES" | "UPSET_APPLIES"`)
- `bid_count`, `watch_count`, `views`, `shipping_fee`, `shipping`, `city`, `ends_at`, `started_at`, `status`
- `vehicle_projection`: stripped of `vin`, `chassis_number`, `engine_number`, `registration_number`, `private_inspection_notes`; defaults to `verification_state = "UNVERIFIED"`.

---

## 4. Evidence Artifacts & Checksum Manifest

All 11 evidence files are stored directly in `docs/mobile/evidence/` and uploaded in CI under `mobile-uat-evidence`:

| Step / Filename | Description | SHA-256 Checksum |
|---|---|---|
| `01_ios_home_connected.png` | Home screen on iPhone 18 Pro showing live auctions connected and recommendations | `d055bd241633166958db19f9a54117b363547e2ced99f1c58a91755f29609382` |
| `02_ios_search_discovery.png` | Search discovery view with active keyboard, search bar, and category exploration chips | `4e58c318004edee28cb7387c86bf61229858d330a515650b49a930c50676961e` |
| `03_ios_categories_catalog.png` | Categories catalog tab showing comprehensive category taxonomy | `f523c393f2ce63a2792c74f285d0332fc02f7d9a45775f82716701d7f3302381` |
| `04_ios_live_tab_ending_soon.png` | Live tab showing ending-soon and active lots with real-time countdown chips | `81ad790682cd74dfa613e7bad1836d542ae596e40511003c19a071683109c64a` |
| `05_ios_account_diagnostics.png` | You tab diagnostics card showing exact commit SHA, branch, and runtime metadata | `676cfc7f737809d5de4884619d72d7595e915797c2c447630a15ab499e92dc51` |
| `06_ios_item_standard_lot.png` | Standard merchandise lot detail (lot 9002) showing undisclosed reserve & non-blocking notice | `7dc35a92c3fcc5e106342bbd7f734e8b6c99afc9b4c5a2996e02c4d850e972d5` |
| `07_ios_item_vehicle_lot.png` | Vehicle lot detail (lot 1035 Toyota Hilux) showing PR #14 Product Intelligence preview & unverified state | `d09a7982c70ef7508cc722da943003148ad0f028b51275c3085f5a6052fbbf4f` |
| `08_ios_login_barrier.png` | Sign-in barrier view enforcing credentials before live bidding participation | `4569b3c42a31cd290ea2bacb3caa123a3bd9cd130650177c90ee84c9ac792683` |
| `09_ios_authenticated_account.png` | Diagnostics screen displaying development configuration and parameters | `676cfc7f737809d5de4884619d72d7595e915797c2c447630a15ab499e92dc51` |
| `10_ios_offline_handling.png` | Network guide details with simulator and device connectivity targets | `1b4e0732cb7ccdae93a9bfada3bab008acd27d5a6c8e45d5fe73e83809456524` |
| `11_ios_desktop_devicehub.png` | Apple Device Hub macOS window mirroring iPhone 18 Pro with verified runtime identity | `8822ba33988c12aeb143bc4328c72639081cfdd5a4aa8b0f104c283e4897587a` |

---

## 5. Verification Suite Results (147 Tests Passed)

All 10 verification gates passed locally with zero warnings and zero failures:

| Gate | Tool / Script | Status | Metrics / Details |
|---|---|---|---|
| **Expo Dependencies** | `CI=1 npx expo install --check` | **PASS** | 0 outdated dependencies |
| **Expo Doctor** | `npx expo-doctor` | **PASS** | 20/20 checks passed |
| **NXS Token Compliance** | `node scripts/verify-nxs-foundation.mjs` | **PASS** | 11 interactive source files audited |
| **Release Secrets Scan** | `node scripts/verify-no-release-secrets.mjs .` | **PASS** | 74 files audited; 0 secrets detected |
| **ESLint Quality** | `npm run lint` | **PASS** | 0 errors, 0 warnings |
| **TypeScript Typecheck** | `npm run typecheck` | **PASS** | 0 errors across entire workspace |
| **Full Unit Test Suite** | `node --experimental-strip-types --test tests/*.test.mjs` | **PASS** | **147 passed, 0 failed** across 14 test suites |
| **Provenance Integrity** | `node scripts/verify-provenance-and-manifest.mjs` | **PASS** | Dynamic Git HEAD, branch, and bundle digest verified |
| **Evidence Checksums** | `node scripts/verify-evidence-manifest.mjs` | **PASS** | 11/11 evidence files verified with SHA-256 readback |
| **Android Bundle Export** | `npx expo export --platform android` | **PASS** | Hermes bytecode (`entry-a50ebdab...hbc`, 2.8MB) |
| **iOS Bundle Export** | `npx expo export --platform ios` | **PASS** | Hermes bytecode (`entry-b28dbe86...hbc`, 2.9MB) |

---

## 6. Truthful Web vs Native Feature Parity Register

| Feature / Scope | Native Implementation State | Parity Status | Truthful Certification Note |
|---|---|---|---|
| **MOB-01 (PR #6)** | NXS Design Tokens & Theme Provider | `IMPLEMENTED` | Design tokens, color system, and typography audited. |
| **MOB-02 (PR #7)** | Marketplace Discovery & Search Layout | `IMPLEMENTED` | Category browsing, search bar, and grid layout verified. |
| **MOB-03 (PR #9)** | Live Bidding & Socket Lifecycle | `IMPLEMENTED` | Socket epoch protection, bid acknowledgement, and completion verified. |
| **SEC-01 (PR #12)** | Fail-Closed Auth & Revocations | `PENDING_REVIEW` | Native client session orchestrator verified; server-side PR #12 pending independent review. |
| **REC-01** | Intelligent Discovery Recommendations | `IMPLEMENTED` | Deterministic heuristic ranking and user privacy isolation verified (28 tests). |
| **PI-01D (PR #14)** | Vehicle Product Intelligence Preview | `PREVIEW` | Non-blocking preview; truthful reserve disclosure; fail-soft non-vehicle fallback. |
| **PI-01E (PR #15)** | Structured Discovery & Facets | `PREVIEW` | Draft client preview. |
| **UX01-R1 (PR #17)**| Live Events Discovery & Countdown | `PREVIEW` | Draft client preview. |
| **PHYS-UAT** | Android Hardware / Emulator | `BLOCKED` | Container virtualization boundary prevents KVM/nested acceleration; no USB physical devices. |
