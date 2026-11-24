# TENGASELL-PULSE-DESIGN-01 — Native Mobile Source, Bundle, Binary and UAT Boundary

**Version:** 1.0.0 / controlling annex to MASTER_PLAN.md  
**Scope:** design/planning instruction now; future engineering only after Owner-authorized I0/I2  
**Native source candidate observed 2026-11-24:** Draft PR #21 HEAD c9fd6f8c2b0f40e562c6154a725636ba3d738923, based on PR #9 HEAD 9bd369ad7000c7564195c1249d75759064706068. **Re-fetch current values before every action.**

## 1. Core distinction: five assets that are NOT interchangeable

| Thing | Meaning | Changes when | Proof |
| --- | --- | --- | --- |
| React Native source | TypeScript/TSX and JS in mobile/src, styles, existing navigation/NXS/components | Agent edits a source branch | Exact git SHA, PR diff, source review |
| Metro development bundle | JS transformed and served by a Metro dev server to a compatible development app | Source changes + Fast Refresh/reload | Dev-server URL + tested source SHA + run receipt; NOT a release binary |
| Platform JS/Hermes export | Built JavaScript/assets for selected platform, potentially Hermes bytecode; not automatically an installed app | Metro/Expo export after metadata generation | Export manifest/hash, source SHA, build logs |
| Installed native binary | Signed/packaged Android APK/AAB or iOS app/IPA with native runtime, modules, assets and entitlements | Full native build/install | Bundle ID, version/build, native binary digest, runtime ABI, signer, device receipt |
| Over-the-air update | Separate channel/runtime-compatible JS/assets published to previously installed binary (only if configured and authorized) | Approved compatible update publication | Update ID, channel, runtimeVersion, target binary cohort, rollout receipt |

No export = installed native app. No Metro Fast Refresh = new native build. No green Expo Doctor or JavaScript tests = iPhone/Android runtime PASS. Screenshots without exact source+native identity are not certification. Do not assume any OTA channel is configured or permitted in the current repo.

## 2. Existing source boundaries and required re-use

Relevant committed files observed:
- mobile/src/app/index.tsx — actual native homepage: useSession, SearchHeader, BottomNav, AuctionCard, fetchAuctions/fetchCategories, recommendedForHome and offline/authority state. Extend through bounded RN components later; do not transplant web DOM/CSS.
- mobile/src/lib/trailbase.ts — canonical network and privacy presentation; current service/API ownership remains under SEC-01 / PI dependencies.
- mobile/src/lib/build-info.ts — separate nativeBinary, bundleSource, metroServer, gateway and runtimeEngine identities; inspect actual semantics, not mere labels.
- mobile/scripts/generate-build-metadata.mjs — transient build metadata generator.
- mobile/scripts/verify-provenance-and-manifest.mjs — later source/UAT manifest enforcement.
- mobile/mobile-uat-manifest.json — test evidence binding; must regenerate per actual candidate/instance.
- .github/workflows/tengasell-mobile-pr.yml — Expo Doctor, typecheck, tests, JS exports, artifact uploads.
- mobile/src/nxs/ and localization/catalog.ts — NXS platform components, tokens and strings; verify exact paths in actual candidate.
- mobile/src/components/{AuctionCard,SearchHeader,BottomNav}.tsx — existing reusable native primitives, subject to current HEAD.

Web equivalents in src/components/tengasell/pages/home/ and src/components/tengasell/ui.tsx are REFERENCE CONTRACTS only. Avoid copying className, DOM elements, CSS variables, Next router props, browser APIs or state assumptions into React Native. Share semantic design-token definitions and API/DTO contracts where approved, not framework-specific source files.

**Design stage D0–D4:** agents may annotate and simulate these structures but MUST NOT edit mobile/ or generate/publish native bundles.

## 3. Future change classification — mandatory before any code request

**Class JS-ONLY (possibly compatible, still needs proof):** Component composition, React Native StyleSheet, string copy, allowed JS-only logic, JS-rendered imagery or safe JS asset references. Require Expo runtime compatibility, JS bundle rebuild, schema/route safety, metro-reload smoke, iOS/Android emulator evaluation and existing regression suite. A signed native binary MAY remain same if strictly JS-only, but report it as SAME NATIVE BINARY + NEW JS BUNDLE.

**Class ASSET-NATIVE:** App icon, launch/splash image, platform fonts packaged natively, native configuration, permission text, associated domains, Android manifest/iOS Info.plist, app scheme or deep-link config. Treat as native rebuild even if the visual appearance seems simple; assess native asset pipeline, splash/icon at required sizes and store distribution.

**Class NATIVE-DEPENDENCY:** Expo SDK, React Native, native module, plugin, deep link, push notification/voice/camera permissions, background service, Hermes/runtime engine, native build configuration. Full native dependency review, Expo Doctor + native build/install on BOTH platforms, environment and plugin compatibility, security review and device UAT required. Never change SDK versions merely to implement a homepage layout.

**Class BACKEND/COMMERCIAL/AI:** New API, model, campaign table, LLM connector, role/permission, bid, settlement, payment, provider or live authority changes. This is NOT a native-homepage edit and requires separate authoritative programme approvals.

**Class OTA:** Forbidden until a separate Owner-approved update policy exists. Any later OTA must prove channel, runtimeVersion, binary compatibility, signing, provenance, rollback and phased delivery. Never publish to shared update channels while PR #21 is still Draft.

Each future mobile engineering task MUST label every change one of these classes and prove whether native binary rebuild is compulsory.

## 4. Development / UAT / release environment matrix

| Environment | What is valid evidence | What it cannot prove |
| --- | --- | --- |
| Static Figma/design prototype | Layout, journey, touch/visual proposal | React Native code, API, device operation |
| Expo Metro on local host | RN UI functionality under dev client, Fast Refresh, basic navigation | Binary rebuild, release JS bundle, Production networking |
| iOS Simulator on macOS | Installed build + actual RN flows, safe area, VoiceOver, session, network | Physical iPhone sensors/network, App Store readiness |
| Android Emulator (with adequate local hardware) | APK installed, back/gesture, font scaling, TalkBack, network, battery/perf proxies | Physical Android variability, Play Store readiness |
| Physical iPhone and Android | On-device installation and critical journeys with real backend in isolated UAT | Production finance/provider certification |
| CI Linux Expo export | Deterministic JS/Hermes transform and unit checks | iOS simulator run, real physical-device UAT, native store release |
| Release signing and staged store | Signed artifact + distribution evidence | Owner approval unless explicitly granted |

A simulator can be running while the installed binary and Metro JS source disagree. Always cross-check displayed source SHA, bundle digest, native app identity and gateway URL. Do not trust window IDs or simulator screenshots alone.

## 5. Exact-source custody & provenance sequence

Future engineer MUST:
1. Read live PR #21 HEAD, parent and current review state; confirm no unauthorized divergence. Work only on approved mobile worktree/branch after I0.
2. Record branch source HEAD (full SHA), PR tested merge SHA, base SHA and working tree state separately.
3. Generate transient metadata at correct pre-build point; never commit a generated file containing its own future commit SHA. Ensure CI verifies the generated metadata matches actual checked-out candidate.
4. Clear stale Metro/JS export caches where necessary. Record JS/Hermes export hash; do not treat a generic "entry.hbc" filename as identity.
5. If running a native binary, capture bundle ID, version/build number, native binary hash, Expo SDK/RN/Hermes details and device OS.
6. Capture network base/authority source without leaking service secrets. The emulator's localhost differs from Mac localhost and from a physical device; use approved gateway/host; never hardcode a simulator-only address into release code.
7. Capture installed app's actual diagnostics showing PR source vs tested merge vs bundle vs binary with truthful UNKNOWN state where unavailable.
8. Run previous MOB session/logout/socket/bid-safety tests plus homepage tests on changed head.
9. Upload screenshots/video, accessible logs, artifact checksums and verified test-device matrix to Owner/reviewer-accessible evidence; no bare local file:/// links.
10. Request independent exact-head native review by @11-eleven-skm. Any new commit after review invalidates previous approval for the changed candidate.

NO cached screenshot can establish a new JavaScript or native build.

## 6. Responsive design-to-native conversion rules

- Design spec is shared: modules P01–P08, role states, copy, public status labels, space/typography/semantics.
- Web uses responsive CSS grid, Next/React routes and existing card primitives.
- Native uses SafeAreaView, RN layouts, platform asset references, FlatList/ScrollView with bounded rendering, native navigation and NXS provider.
- Referenced responsive dimensions: native iOS 375/390/430pt; Android 360/393/412dp; tablet and large phone need real layout logic and accessible font scale.
- No web HTML, web-only CSS, localStorage, Next router or direct web sockets ported without a native-specific adapter.
- No duplicate native auction-core logic: reuse authoritative gateways; never infer LIVE or bid eligibility from countdown.
- Offline state: neutral unavailable and retry; do not show demo auctions as live. Eager carousel/video is forbidden on slow connections by default.
- Paid ads must remain separated from watchlist and organic inventory, with sponsor label exposed to VoiceOver/TalkBack.
- Notification and AI voice are separately permissioned native features; no automatic requests for push, mic, location or speech at app startup.

## 7. Mandatory native QA test cases (later I2/I5)

MOB-P01: guest search and accessible input. MOB-P02: genuine category and empty state. MOB-P03: canonical LIVE + linked session/current-lot authority. MOB-P04: LIVE lost/reconnect/status mismatch disables live CTA. MOB-P05: signed buyer + own watchlist; expired account public fallback. MOB-P06: seller/business permission isolation and no cross-tenant data. MOB-P07: sponsored disclosure and withdrawn promotion takedown. MOB-P08: offline/slow 2G-like data and no fictional auction facts. MOB-P09: accessibility large text/VoiceOver/TalkBack and 44pt/48dp targets. MOB-P10: deep-link/back navigation, app foreground/background session continuity. MOB-P11: equivalent JS source on both platform exports with platform-specific binary/source receipts. MOB-P12: change class ASSET-NATIVE triggers mandatory rebuild; JS-ONLY does not silently claim native rebuild. MOB-P13: reinstall/restart stale OTA/Metro handling, channel separation and rollback (OTA only if authorized). MOB-P14: no AI/marketing notification without consent and provider gating.

Preserve exact test ID and show PASS/FAIL/BLOCKED/NOT_EXECUTED per iOS simulator, Android emulator and physical devices. No invented pass percentages.

## 8. NXS acceptance and stop conditions

- Current mobile PR #21 stays Draft/untouched during D0–D4.
- No Expo export, EAS build/update, app-store publication, signed binary, simulator install or release operation authorized by this planning document.
- If a design asks for new native package/plugin or changed permissions, annotate as a new dependency, do not add it during design.
- If web and mobile design content requires different backend truth, stop and reconcile through SEC-01 / PI / Live Comms owner.
- Formal release gate remains NO MERGE / NO DEPLOY / NO OTA / NO BILLING / NO PROVIDER ACTIVATION.

This annex is a mandatory reference in all later native specialist prompts, exact-head reviews and moderator handoffs.
