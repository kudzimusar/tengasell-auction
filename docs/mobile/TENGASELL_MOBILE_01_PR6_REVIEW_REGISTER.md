# PR #6 — full-scope review register

**Purpose:** give an independent reviewer the whole `main → PR #6` candidate, not
the incremental patch. PR #6 introduces the entire TengaSell mobile application;
it is not an SDK dependency change.

**Base:** `main` @ `98a607c3`
**Measured at:** `916eed1` — the LR03 code freeze on this branch.
**Size at that revision:** 52 files, +17877, −0 (matches the GitHub diff).

> Counts in this register are pinned to `916eed1` so they cannot drift while the
> document is edited. A later documentation-only commit changes only the rows
> for documentation and the total by the same delta; GitHub's diff view at the
> current PR head is authoritative.

---

## 1. What a reviewer is accepting

| scope | content | why it matters |
| --- | --- | --- |
| **A — merge scope** | the whole `mobile/` application, NXS foundation, session/auth, transport, tests, gates, CI, programme docs | this is the artefact. Review A. |
| **B — incremental since R2** | SDK 58 patch alignment; RACE01 barrier and its stale-write cleanup | small, already isolated in commit messages |
| **C — historical gates** | R2/DEP01 acceptance evidence dated 2026-10-31 | prior evidence, not new code |
| **D — new gates** | mobile PR CI, RACE01/ACK/BID suites, conflict-marker gate, release-secret gate, provenance recorder | the enforcement layer |

A reviewer who reads only B would conclude “a dependency bump with a login fix”.
That would understate the candidate by roughly 17.9k lines of application code.

## 2. Source ownership

| area | owned by | notes |
| --- | --- | --- |
| App routes (`src/app/**`) | MOB-02 | **three screens plus the root layout**: home (`index.tsx`), account (`account/index.tsx`), sign-in (`auth/login.tsx`), router shell (`_layout.tsx`). Item detail, categories, search, orders arrive in PR #7. |
| Session and authentication (`src/auth/**`) | MOB-01 / R3 / RACE01 | generation-checked persistence, logout transaction, pre-auth barrier, stale-write cleanup |
| Transport and domain (`src/lib/**`) | MOB-01 (+ MOB-03 in #8) | TrailBase read client; socket client and bid contract land in #8 |
| NXS design system (`src/nxs/**`) | MOB-01 | tokens, provider, English launch catalogue, text runtime |
| Regression suites (`tests/**`) | per unit | R3 13, RACE01 13 (10 barrier + 3 stale-write) |
| Engineering gates (`scripts/**`) | MOB-01 | NXS static audit, advisory policy, release-secret scan |
| CI (`.github/workflows/**`) | MOB-01 | one blocking mobile gate; three legacy workflows retired to dispatch-only |

## 3. File register

| area | file | + | − |
| --- | --- | --- | --- |
| App routes (UI) | `mobile/src/app/_layout.tsx` | 43 | 0 |
| App routes (UI) | `mobile/src/app/account/index.tsx` | 361 | 0 |
| App routes (UI) | `mobile/src/app/auth/login.tsx` | 345 | 0 |
| App routes (UI) | `mobile/src/app/index.tsx` | 607 | 0 |
| Session and authentication | `mobile/src/auth/login-barrier.ts` | 57 | 0 |
| Session and authentication | `mobile/src/auth/logout-transaction.ts` | 70 | 0 |
| Session and authentication | `mobile/src/auth/session-context.tsx` | 468 | 0 |
| Session and authentication | `mobile/src/auth/session-storage-logic.ts` | 127 | 0 |
| Session and authentication | `mobile/src/auth/session-storage.ts` | 29 | 0 |
| Transport and domain | `mobile/src/lib/format.ts` | 184 | 0 |
| Transport and domain | `mobile/src/lib/trailbase.ts` | 280 | 0 |
| Transport and domain | `mobile/src/lib/types.ts` | 322 | 0 |
| NXS design system and localisation | `mobile/src/nxs/components/NxsButton.tsx` | 97 | 0 |
| NXS design system and localisation | `mobile/src/nxs/context/NxsProvider.tsx` | 228 | 0 |
| NXS design system and localisation | `mobile/src/nxs/localization/catalog.ts` | 218 | 0 |
| NXS design system and localisation | `mobile/src/nxs/localization/runtimeMessages.ts` | 71 | 0 |
| NXS design system and localisation | `mobile/src/nxs/localization/useNxsText.ts` | 19 | 0 |
| NXS design system and localisation | `mobile/src/nxs/tokens/index.ts` | 153 | 0 |
| Regression suites | `mobile/tests/login-barrier.test.mjs` | 258 | 0 |
| Regression suites | `mobile/tests/logout-continuity.test.mjs` | 240 | 0 |
| Regression suites | `mobile/tests/race01-stale-write.test.mjs` | 74 | 0 |
| Engineering gates | `mobile/scripts/verify-dependency-audit.mjs` | 70 | 0 |
| Engineering gates | `mobile/scripts/verify-no-release-secrets.mjs` | 60 | 0 |
| Engineering gates | `mobile/scripts/verify-nxs-foundation.mjs` | 178 | 0 |
| CI workflows | `.github/workflows/tengasell-mobile-mob01-r3-dep01.yml` | 100 | 0 |
| CI workflows | `.github/workflows/tengasell-mobile-mob01-r3.yml` | 76 | 0 |
| CI workflows | `.github/workflows/tengasell-mobile-mob01.yml` | 67 | 0 |
| CI workflows | `.github/workflows/tengasell-mobile-pr.yml` | 158 | 0 |
| Dependencies | `mobile/package-lock.json` | 11436 | 0 |
| Dependencies | `mobile/package.json` | 38 | 0 |
| Configuration | `.dockerignore` | 3 | 0 |
| Configuration | `mobile/.gitignore` | 41 | 0 |
| Configuration | `mobile/AGENTS.md` | 41 | 0 |
| Configuration | `mobile/app.json` | 44 | 0 |
| Configuration | `mobile/eslint.config.js` | 9 | 0 |
| Configuration | `mobile/nxs-experience-manifest.yaml` | 51 | 0 |
| Configuration | `mobile/tsconfig.json` | 7 | 0 |
| Assets | `mobile/assets/adaptive-icon.png` | binary | - |
| Assets | `mobile/assets/android-icon-background.png` | binary | - |
| Assets | `mobile/assets/android-icon-foreground.png` | binary | - |
| Assets | `mobile/assets/android-icon-monochrome.png` | binary | - |
| Assets | `mobile/assets/favicon.png` | binary | - |
| Assets | `mobile/assets/icon.png` | binary | - |
| Assets | `mobile/assets/splash-icon.png` | binary | - |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_NXS_FOUNDATION.md` | 132 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_PR6_REVIEW_REGISTER.md` | 158 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_PROGRAMME.md` | 508 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_R2_ACCEPTANCE.md` | 77 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_R2_DEPENDENCY_SECURITY.md` | 49 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_R3_DEP01.md` | 51 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_01_R3_SESSION_CONTINUITY.md` | 61 | 0 |
| Programme documentation | `docs/mobile/TENGASELL_MOBILE_UNBLOCK_01_LR02_INTEGRATION.md` | 211 | 0 |

## 4. Principal security assumptions

An independent reviewer should confirm each of these against the source, not
against this list:

1. **Single commercial authority.** Every bid is written by the Socket.IO trade
   engine; no Prisma auction write and no direct bid-record write exists in
   `mobile/src`.
2. **Read path is read-only.** `src/lib/trailbase.ts` performs record reads only.
3. **Token custody.** The auth token is held in the session provider, persisted
   through SecureStore, and passed to the socket as `auth.token`; it is never
   written to logs.
4. **Generation ownership.** Login takes ownership synchronously before its
   first await; logout increments the generation before any await; persistence
   and publication both re-check; a stale write is deleted by its owner.
5. **Fail-closed restoration.** A restoration that cannot prove its own
   freshness surfaces `session-invalid` rather than an authenticated shell.
6. **Logout precedence.** A pending credential write is awaited, then the clear
   is applied; an incomplete clear surfaces `signout-incomplete` rather than
   pretending success.
7. **Connection ownership.** A connect that resolves after logout/account
   switch is torn down, not adopted (PR #8).
8. **No release material.** Keystore, passwords and signed artefacts live
   outside the repository; a CI gate enforces this.
9. **Locale.** English-only at launch; no partially translated catalogue.
10. **Touch floor.** 48×48 is normative for every interactive element on an app
    route, enforced statically.

## 5. Evidence attached to this candidate

| evidence | where |
| --- | --- |
| blocking mobile gate (18 steps) | `.github/workflows/tengasell-mobile-pr.yml` |
| suite results | CI job `mobile-gates`, per-step |
| dependency advisory policy outcome | CI step “Dependency security assessment” |
| provenance (event, PR, source, base, tested merge, workflow head, run) | CI step “Prove exact head and record provenance”; job summary |
| Android + iOS bundle export | CI steps “Android export” / “iOS export” |
| release-secret scan | CI step “Release-secret boundary (REL-002/REL-004)” |
| inherited web lint debt | `ci.yml` job `Lint and typecheck (baseline debt — non-blocking)` |

## 6. Reviewer checklist

1. Does any path in `src/` write an auction or bid record outside the trade
   engine?
2. Is ownership taken before the first await on **every** privileged path, or
   only on login?
3. Can a `session-invalid` state still render authenticated UI?
4. Does a failed SecureStore write leave credentials in memory or on disk?
5. Is the socket token refreshed on account switch, or reused?
6. Are the 48×48 claims enforced by the static gate for every app route?
7. Does the mobile gate fail closed if a suite is missing, or silently skip it?
   (It skips by design only where the unit does not exist yet — see §7.)
8. Does any documentation contain release material that would let a reader
   reproduce signing?

## 7. Known gaps a reviewer must not attribute to this PR

- **Conditional suites.** The navigation, socket, ACK and BID suites run only
  where their files exist. On `main → #6` they do not exist, so the gate runs
  R3 + RACE01 (26 tests). The same workflow runs every suite on #7 and #8.
- **No branch protection.** The gate fails honestly but `main` has no required
  checks, so it cannot block a merge. See the receipt §12.6.
- **Physical certification.** Not performed; no hardware. SecureStore
  durability, assistive technology and 200% text are unproven on device.
- **Context-level auth tests.** RACE01 and the stale-write cleanup are tested at
  module and storage-driver level; no test renders `SessionProvider`. Disclosed
  as residual coverage risk, not as passing evidence.
- **Inherited web debt.** The root web lint job fails with 20 errors on `main`
  itself; no root application source changes in this PR.
