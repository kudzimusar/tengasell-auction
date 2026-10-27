# TENGASELL-MOBILE-01 — Native Mobile Programme Charter

**Programme:** TENGASELL-MOBILE-01
**Framework:** MSCS 1.0 · UDPCS 1.0 · VAP 1.0 (11-11 Tech, proprietary)
**Parent:** `main` of kudzimusar/tengasell-auction (web platform, TENGASELL-AUCTION-01)
**Programme owner:** Kudzanai Musarurwa
**Implementer / verifier segregation:** implementation and verification are separate roles per VAP §4; no self-issued PASS.

---

## 1. Framework authority

| Source | What it requires for a native app |
| --- | --- |
| **MSCS 1.0 §REL** | REL-002 Mobile signing · REL-003 Apple distribution · REL-004 Google Play distribution · REL-005 Beta distribution · REL-006 Release notes · REL-007 Version tracking · REL-008 Phased rollout · REL-009 Rollback · REL-010 Store compliance · REL-011 Privacy declarations · REL-012 Crash monitoring (M1–M2, C2, E1+E2[+E4]) |
| **MSCS 1.0 §EXP** | EXP-006 Navigation · EXP-007 Responsive UI · EXP-008 Mobile experience · EXP-009 Onboarding · EXP-012 Offline/degraded-state UX (M1–M2, C2, E1+E2+E4) |
| **MSCS 1.0 §MSG / §IAM / §SEC** | MSG-003 Push notifications · MSG-004 In-app notifications · MSG-006/008/015 preferences/localization/emergency (C2) · IAM-004 MFA, IAM-006 Session management, IAM-017 Device inventory (C3) |
| **MSCS registry (repo)** | 25 directly mobile-relevant controls verified against `prisma/mscs-registry.json` — plus every commercial control (MKT/COM, largely C3) re-proven on the native surface |
| **UDPCS 1.0** | EXP-01: experience across web, mobile and other channels · REL-01: app-store deployment with store approval evidence, signing custody, rollout log · R10: Google Play User Data policy |
| **VAP 1.0** | §6 Candidate Authority & Exact-Head Custody · §7 Evidence hierarchy P0–P… · §8 Verification Depth: **C2 → V1+V2+V3/V4 minimum; C3 → V1–V5 + relevant V6; C4 → V1–V7** · §9 positive/negative/adversarial test design · §13 Implementation Completion Manifest with the READY_FOR_VERIFICATION declaration |

---

## 2. Canonical authority (binding, per TENGASELL-AUCTION-IMP-01)

The native client consumes **only** the canonical commercial authority:

```
TrailBase (Rust, :3001)  records + auth
Socket.IO trade engine (:3002)  bids, offers, live rooms — all commercial writes
Gateway (?XTransformPort routing)  same URL and conventions as the web app
```

Prohibited in the native app: direct Prisma writes, Next BFF as an authority for
auction state, any local store for **commercial mutations**. Offline browsing may
cache reads (EXP-012) but never author writes.

---

## 3. Technology decision record (DOC-012 style)

**Decision: Expo (React Native) + TypeScript.** Rejected alternatives recorded.

| Option | Verdict |
| --- | --- |
| **Expo / React Native** (chosen) | Reuses the TypeScript domain layer verbatim (`types.ts`, `format.ts`, `toAuctionView`), `socket.io-client`, the same gateway contract and the same design tokens. EAS provides signing custody (REL-002), store builds (REL-003/004), phased rollouts (REL-008) and OTA rollback (REL-009). |
| Flutter | Full rewrite in Dart; zero reuse of the TypeScript contract; second language to maintain. Rejected. |
| Kotlin + Swift | Two codebases, two release trains; 2× the REL-002..012 burden. Rejected for this stage. |
| TWA (Bubblewrap) | Already scaffolded earlier; rejected as "real native" because it is a browser shell — it cannot satisfy EXP-008 evidence depth E4 and leaves no native surface for push/crash/offline work. |

Recorded: `docs/mobile/` of this repo. Custody per VAP §6.

---

## 4. Unit plan

| Unit | Scope | Controls (floor/criticality) | Min. VAP depth | Migrations |
| --- | --- | --- | --- | --- |
| **MOB-00** | Charter, custody record, decision records, environment (EAS project) | DOC-011, DOC-012 (M2/C1) | V1 | none |
| **MOB-01** | Expo workspace · API client (canonical) · auth/session (IAM) · shell/navigation · token port | IAM-006 (C3), EXP-006/007/008, ACC-001/009/010, I18N | **V1–V5** (IAM-006) | none |
| **MOB-02** | Browse: home, category, search, item detail, vehicle intelligence views | SRC, MKT-009, EXP-008/012 | V1+V2+V3/V4 | none |
| **MOB-03** | Live commerce: bidding via Socket.IO, offers, live rooms, retraction | MKT (C3 set) | **V1–V5** | none |
| **MOB-04** | Sell flow, orders, checkout, Paynow hand-off | COM (C3 set) | **V1–V5** | none |
| **MOB-05** | Messaging, push + in-app notifications, preferences, localization, emergency | MSG-003/004/006/008/015 | V1+V2+V3/V4 | none |
| **MOB-06** | Signing custody, Play internal→closed→production, beta (TestFlight/Internal), release notes, version tracking, phased rollout, rollback, store compliance, privacy declarations, crash monitoring (Sentry) | REL-002..012 | V1+V2+V3/V4 + store evidence (V7) | none |
| **CERT-MOB-01** | Independent verification pass per unit; certification adjudication | VAP §14–§16 | V1–V7 as applicable | none |

No database migrations are planned for the mobile client — it adds a client surface,
not schema. Any schema change stays in TENGASELL-AUCTION-01 with its own ledger.

---

## 5. Status

| Unit | State |
| --- | --- |
| MOB-00 | Draft charter (this document); custody record below |
| MOB-01 | **In progress** — Expo workspace scaffolded; `types.ts` + `format.ts` ported verbatim; canonical API client + browse slice written; awaiting verification |
| MOB-02..CERT-MOB-01 | Not started |

---

## 6. Candidate Authority Record (VAP §6) — MOB-01

```
repository:        kudzimusar/tengasell-auction
branch:            feat/tengasell-mobile-01-foundation
base_sha:          <main head at branch creation>
candidate_sha:     <set at commit>
build_id:          <EAS build id — not yet produced>
deployment_id:     <n/a — no store deployment yet>
environment:       local dev / staging tunnel
database_migration_state: unchanged from TENGASELL-AUCTION-01 ledger (U1..U16)
configuration_revision: EXPO_PUBLIC_TENGASELL_API = https://english-merely-commonwealth-sole.trycloudflare.com
app_version:       0.1.0
api_version:       /api/records/v1 (TrailBase v0.35.1)
verified_at:       <filled by verifier, not implementer>
```

---

## 7. Implementation Completion Manifest (VAP §13) — MOB-01 foundation slice

- **Project / Work Unit:** TENGASELL-MOBILE-01 · MOB-01 (foundation: workspace, client, browse slice)
- **Governing requirement:** IAM-006, EXP-006/007/008, ACC-001/009/010, I18N; canonical-authority constraint of IMP-01
- **Base SHA / Candidate SHA:** recorded in git on `feat/tengasell-mobile-01-foundation`
- **Branch / PR:** `feat/tengasell-mobile-01-foundation` (PR opened after verification staging)
- **Build / deployment:** not yet built on EAS — pending
- **Changed files:** `mobile/` (Expo workspace, App.tsx, src/lib/{trailbase,types,format}.ts, app.json, assets) · `docs/mobile/TENGASELL_MOBILE_01_PROGRAMME.md` · `.dockerignore` (mobile excluded from web image)
- **Schema / migrations:** none
- **Implementation summary:** Expo TypeScript workspace; verbatim domain-type port; canonical records-API client using the gateway's `XTransformPort` convention; native browse slice (probe → Live/Demo pill, category chips, live-auction cards with countdown/price/bids) reusing `formatUSD`, `formatRemaining`, `remainingSeverity`, `toAuctionView` unchanged.
- **Tests executed (implementer-run, V1/V2 evidence):**
  - `npx tsc --noEmit` in `mobile/` → **0 errors** (exit 0)
  - `npx expo export --platform android` → **exit 0**, Hermes bundle 1.5 MB (`dist/_expo/static/js/android/index-*.hbc`)
  - Canonical-authority reachability of the staging gateway verified out-of-band (records API 200, 55 auctions) — tunnel environment, not device runtime; device runtime (V3/V4) awaits the verifier
- **Known limitations:** auth, bidding, messaging, push, stores, signing — later units; no EAS build yet; tunnel URL is ephemeral (staging only)
- **Known failures:** disclosed at verification time
- **Evidence pointers:** this repo · `mobile/` diff · CI job to be added in MOB-01 completion
- **Ready state:** READY_FOR_VERIFICATION

> **STATUS: READY_FOR_VERIFICATION** — I do not self-certify this work. The statements above are
> implementation claims and evidence references for independent verification. Known failures and
> limitations have been disclosed to the best of my available evidence. (VAP §13 declaration)

---

## 8. External dependencies — owner-supplied (not code)

| Need | Control | Owner action |
| --- | --- | --- |
| Apple Developer Program ($99/yr) | REL-003 | user enrolment |
| Play Console developer account ($25) | REL-004 | already held; verify ID/identity status |
| Signing custody decision: EAS-managed keystore vs local | REL-002 | user decision; EAS recommended (key escrow + Play App Signing) |
| FCM server key / APNs key | MSG-003 | Firebase project + Apple push cert |
| Sentry project (free tier) | REL-012 | user-owned org |
| Stable production URL (named tunnel or domain) | REL-010 | replaces the ephemeral quick tunnel before store submission |

---

## 9. Sequencing and honesty notes

- MOB-01 must reach V1–V5 evidence for IAM-006 before auth is claimed; the current
  slice is read-only and carries no session surface yet.
- The staging tunnel hostname changes on restart; nothing store-facing may cite it
  as its permanent URL (REL-010).
- Every unit ends with a manifest; CERT-MOB-01 (independent verifier, not the
  implementer) adjudicates per VAP §16.
