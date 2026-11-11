# TENGASELL-MOBILE-01 — `CERT-05` Physical UAT Handoff & `CLOSE-01` Verification Record

**Unit:** `MOB-01-ICR03-R2-CLOSE-01`  
**Repository:** `kudzimusarurwa/tengasell-auction`  
**Main Baseline (unmodified):** `98a607c326ca4bcf24062c045d4eaa35762a3aa5`

---

## 1. Non-Overstated Physical Device & Hardware Custody (`CERT-05`)

The following statuses are **mandatory truth constraints** and remain open until physical hardware UAT completes:

| Dimension | Current Status | Boundary Reason |
| --- | --- | --- |
| **Android physical UAT** | `ANDROID PHYSICAL — BLOCKED` | No physical Android handset attached (`adb` saw only local emulator previously). |
| **iOS physical UAT** | `IOS PHYSICAL — BLOCKED` | No physical iPhone / Xcode physical provisioning session attached. |
| **Native hardware SecureStore / Keychain** | `NATIVE SECURESTORE — NOT CERTIFIED` | Auth/storage suites (`50/50`) drive logic via deterministic in-memory storage doubles. |
| **Physical NXS typography / screen readers / 48pt** | `PHYSICAL NXS — NOT CERTIFIED` | TalkBack, VoiceOver, 200% OS font scaling, and narrow physical viewports not executed on real hardware. |
| **Current-HEAD end-to-end live physical bidding** | `CURRENT-SHA LIVE BIDDING — NOT CERTIFIED` | Earlier emulator test (`@nyasha`, auction `1015`, `bids` row `444`) ran strictly on superseded historical commit `5011c35`; APK/AAB has **not** been rebuilt on PR #9 final HEAD. |

### Physical Device Execution Matrix (When Hardware Is Connected)

Do not start `MOB-04` or promote Play Console tracks until all physical checks pass against a staging build from the merged stack:

1. **Cold-start SecureStore / Logout / Account Switch (`PR #6`):** Sign in online, force-kill OS app task, relaunch and verify restored session; sign out offline & online (`logout` generation barrier + durable signout intent); switch between two buyer accounts and verify zero cross-account profile/bid state leakage.
2. **NXS Accessibility & Viewport (`PR #7`):** Enable 200% OS Dynamic Type / Font Scaling + TalkBack (Android) / VoiceOver (iOS) on Home, Categories, Search, Item Detail, Orders, and Account; verify zero truncated currency/countdown labels, square responsive hero media, and `>= 48pt` tap targets (`All`, `Try again`, `Sign in`, `Back`, `Browse items`).
3. **Bidding & Post-Ack Reconciliation (`PR #9`):** On an open staging auction, verify winning bid (`winning: true`), covered proxy auto-bid (`outbid: true`), mid-flight airplane mode (`uncertain` → canonical reconcile without replay), expired countdown (`Ends in 0s` → `Auction closed`), and immediate UI disable on sign-out.
4. **Rebuild & Track Custody (`REL-004`):** After physical sign-off and `trade-engine` remediation packet merge (`P0/P1`), rebuild signed release AAB (`versionCode: 2`) using `~/.tengasell/android/tengasell-release.keystore` (`scripts/apply-release-signing.sh`, secrets out of git).

---

## 2. `CERT-04` Owner Branch Protection Checklist (`main`)

**Repository state:** `main` currently has zero active branch protection rules or rulesets (`404` / `[]`). **Do not enable protection without Owner sign-off.**

Once PR #6, Governance PR #10 (`mobile-or-skip-gate`), PR #7, and PR #9 (plus backend trade-engine remediation before live bidding) are ready:

1. Merge PR #6 (or merge Governance PR #10 directly into PR #6 / right after PR #6) so `.github/workflows/tengasell-mobile-pr.yml` on `main` exports the unconditional **`mobile-or-skip-gate`** job context.
2. Under **GitHub → Settings → Branches / Rulesets (`main`)**:
   - Require a pull request before merging (at least 1 approving review, dismiss stale approvals on new pushes).
   - Require status checks to pass before merging (`Require branches to be up to date`):
     - Require **`Build and smoke test`** (root web `.github/workflows/ci.yml`; keep non-blocking debt job `Lint and typecheck (baseline debt — non-blocking)` **excluded** from required checks until web debt is resolved).
     - Require **`mobile-or-skip-gate`** (from `Tengasell Mobile — PR gates`).
   - Do **NOT** set raw `mobile-gates` as a standalone required check once path-filtering skips it on web-only PRs — `mobile-or-skip-gate` enforces `mobile-gates == success` on all mobile/workflow PRs and reports clean not-applicable `success` when non-mobile PRs skip Expo cleanly.
   - Disallow force-push and branch deletion on `main`.
3. Follow stacked merge sequence: merge PR #6 → retarget PR #7 base to `main` & fast-forward/merge `main` → merge PR #7 → retarget PR #9 base to `main` & merge `main` → merge PR #9.

---

## 3. Advisory & Root-CI Segregation Note

- **GitHub CI vs Local `npm audit`:** Keep both verified observations explicit and reconciled: Nov 10 CI (`42819932802`) observed `0` critical, `1` high (`zod`), `12` moderate; Nov 11 local verification (`395205a` / `65a57dc3`) observed `0` critical, `1` high (`zod` via dev-only `eslint-config-expo@58.0.4` → `eslint-plugin-react-hooks@7.1.1`), `10` moderate (policy decision: `KNOWN_TOOLING_CHAIN_REQUIRES_EXPO_PATCH`).
- **Root web `ci.yml`:** `Build and smoke test` passes (`GET / -> 200`, `GET /api/public/status -> 200`, `GET /api/v1/listings -> 401`); `Lint and typecheck (baseline debt — non-blocking)` continues failing on pre-existing root Next.js web lint/TS errors (`continue-on-error: true`), completely outside mobile PR scope.
- **Preserved stashes:** `stash@{0}` (`audit policy`) and `stash@{1}` (`LR02 work split`) remain untouched locally.
