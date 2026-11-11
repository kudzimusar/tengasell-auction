# PR #6 — full-scope review register

**Purpose:** give an independent reviewer the whole `main → PR #6` candidate, not
the incremental patch. PR #6 introduces the entire TengaSell mobile application;
it is not an SDK dependency change.

**Base:** `main` @ `98a607c3`
**Measured at:** `937fcc3` — the ICR02 freeze on this branch.
**Size at that revision:** 55 files, +18,584, −0 (matches `git diff --numstat origin/main...937fcc3`).

> Counts in this register are pinned to `937fcc3` so they cannot drift while the
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
That would understate the candidate by roughly 18.6k lines of application code.

## 2. Source ownership

| area | owned by | notes |
| --- | --- | --- |
| App routes (`src/app/**`) | MOB-02 | **three screens plus the root layout**: home (`index.tsx`), account (`account/index.tsx`), sign-in (`auth/login.tsx`), router shell (`_layout.tsx`). Item detail, categories, search, orders arrive in PR #7. |
| Session and authentication (`src/auth/**`) | MOB-01 / R3 / RACE01 / ICR02 | generation-checked persistence, logout transaction, pre-auth barrier; credential operations serialized behind one queue, provider publication extracted to `session-orchestrator.ts` |
| Transport and domain (`src/lib/**`) | MOB-01 (+ MOB-03 in #8) | TrailBase read client; socket client and bid contract land in #8 |
| NXS design system (`src/nxs/**`) | MOB-01 | tokens, provider, English launch catalogue, text runtime |
| Regression suites (`tests/**`) | per unit | R3 13, RACE01 13 (10 barrier + 3 stale-write), ICR02 14 (9 storage concurrency + 5 orchestration) |
| Engineering gates (`scripts/**`) | MOB-01 | NXS static audit, advisory policy, release-secret scan |
| CI (`.github/workflows/**`) | MOB-01 | one blocking mobile gate; three legacy workflows retired to dispatch-only |

## 3. File register

| area | file | + | − |
| --- | --- | --- | --- |
| Configuration | `-` | binary | mobile/assets/adaptive-icon.png |
| Configuration | `-` | binary | mobile/assets/android-icon-background.png |
| Configuration | `-` | binary | mobile/assets/android-icon-foreground.png |
| Configuration | `-` | binary | mobile/assets/android-icon-monochrome.png |
| Configuration | `-` | binary | mobile/assets/favicon.png |
| Configuration | `-` | binary | mobile/assets/icon.png |
| Configuration | `-` | binary | mobile/assets/splash-icon.png |
| Configuration | `100` | 0 | .github/workflows/tengasell-mobile-mob01-r3-dep01.yml |
| Configuration | `100` | 0 | mobile/tests/session-orchestrator.test.mjs |
| Configuration | `11436` | 0 | mobile/package-lock.json |
| Configuration | `132` | 0 | docs/mobile/TENGASELL_MOBILE_01_NXS_FOUNDATION.md |
| Configuration | `153` | 0 | mobile/src/nxs/tokens/index.ts |
| Configuration | `160` | 0 | .github/workflows/tengasell-mobile-pr.yml |
| Configuration | `167` | 0 | docs/mobile/TENGASELL_MOBILE_01_PR6_REVIEW_REGISTER.md |
| Configuration | `178` | 0 | mobile/scripts/verify-nxs-foundation.mjs |
| Configuration | `184` | 0 | mobile/src/lib/format.ts |
| Configuration | `19` | 0 | mobile/src/nxs/localization/useNxsText.ts |
| Configuration | `210` | 0 | mobile/src/auth/session-storage-logic.ts |
| Configuration | `218` | 0 | mobile/src/nxs/localization/catalog.ts |
| Configuration | `228` | 0 | mobile/src/nxs/context/NxsProvider.tsx |
| Configuration | `240` | 0 | mobile/tests/logout-continuity.test.mjs |
| Configuration | `255` | 0 | mobile/tests/storage-concurrency.test.mjs |
| Configuration | `258` | 0 | mobile/tests/login-barrier.test.mjs |
| Configuration | `280` | 0 | mobile/src/lib/trailbase.ts |
| Configuration | `29` | 0 | mobile/src/auth/session-storage.ts |
| Configuration | `3` | 0 | .dockerignore |
| Configuration | `322` | 0 | mobile/src/lib/types.ts |
| Configuration | `345` | 0 | mobile/src/app/auth/login.tsx |
| Configuration | `361` | 0 | mobile/src/app/account/index.tsx |
| Configuration | `38` | 0 | mobile/package.json |
| Configuration | `41` | 0 | mobile/.gitignore |
| Configuration | `41` | 0 | mobile/AGENTS.md |
| Configuration | `411` | 0 | docs/mobile/TENGASELL_MOBILE_UNBLOCK_01_LR02_INTEGRATION.md |
| Configuration | `43` | 0 | mobile/src/app/_layout.tsx |
| Configuration | `44` | 0 | mobile/app.json |
| Configuration | `472` | 0 | mobile/src/auth/session-context.tsx |
| Configuration | `49` | 0 | docs/mobile/TENGASELL_MOBILE_01_R2_DEPENDENCY_SECURITY.md |
| Configuration | `508` | 0 | docs/mobile/TENGASELL_MOBILE_01_PROGRAMME.md |
| Configuration | `51` | 0 | docs/mobile/TENGASELL_MOBILE_01_R3_DEP01.md |
| Configuration | `51` | 0 | mobile/nxs-experience-manifest.yaml |
| Configuration | `54` | 0 | mobile/src/auth/session-orchestrator.ts |
| Configuration | `57` | 0 | mobile/src/auth/login-barrier.ts |
| Configuration | `60` | 0 | mobile/scripts/verify-no-release-secrets.mjs |
| Configuration | `607` | 0 | mobile/src/app/index.tsx |
| Configuration | `61` | 0 | docs/mobile/TENGASELL_MOBILE_01_R3_SESSION_CONTINUITY.md |
| Configuration | `67` | 0 | .github/workflows/tengasell-mobile-mob01.yml |
| Configuration | `7` | 0 | mobile/tsconfig.json |
| Configuration | `70` | 0 | mobile/scripts/verify-dependency-audit.mjs |
| Configuration | `70` | 0 | mobile/src/auth/logout-transaction.ts |
| Configuration | `71` | 0 | mobile/src/nxs/localization/runtimeMessages.ts |
| Configuration | `74` | 0 | mobile/tests/race01-stale-write.test.mjs |
| Configuration | `76` | 0 | .github/workflows/tengasell-mobile-mob01-r3.yml |
| Configuration | `77` | 0 | docs/mobile/TENGASELL_MOBILE_01_R2_ACCEPTANCE.md |
| Configuration | `9` | 0 | mobile/eslint.config.js |
| Configuration | `97` | 0 | mobile/src/nxs/components/NxsButton.tsx |

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
   and publication both re-check. Credential mutations are serialized in the
   storage authority, so a stale cleanup cannot interleave with a newer login's
   write, and an unverifiable cleanup sets the durable marker instead of
   trusting the store.
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


---

## ICR03-LR01 Independent Certification Update (Code Freeze `395205a`)

**Review unit:** `MOB-01-ICR03-LR01` (Independent Certification & Merge-Readiness Specialist)  
**Historical baseline preserved above:** `937fcc3` (55 files, +18,584) · **Prior candidate:** `1131fac` → `688b7be` · **Remediated code freeze:** `395205a29a23814e5118b8b351e389abd0905fe0` (57 files vs `main` `98a607c326ca4bcf24062c045d4eaa35762a3aa5`, +19,048 / −0)

### 1. Remediations Applied in `395205a`

1. **`mobile/src/auth/protected-request.ts` + `mobile/tests/protected-request.test.mjs` (`ICR03-D2`, `ICR03-10`):** Ported the generation check before `deps.onRefreshed(...)` on both the proactive expiring-token refresh path and the reactive 401-retry refresh path (previously landed only on MOB-03 in `01dc953`), plus unit test `ICR03-10`.
2. **`mobile/src/auth/session-context.tsx`:** Captured `expectedGeneration = ++generationRef.current` in `clearLocalSession` and guarded `setSnapshot(...)` in `finally` with `generationRef.current === expectedGeneration` so an in-flight clear cannot overwrite a concurrent `logout()` (`signout-pending`) or newer `login()`; moved `expectedGeneration` capture *before* `await readStoredSession()` in `refreshSession` and rejected cleanly on generation shift.
3. **`mobile/scripts/verify-nxs-foundation.mjs`:** Switched `declaredSize` from `Math.max` to `Math.min` across explicit `minHeight`/`minWidth`/`height`/`width` declarations so a wide-but-short control cannot clear the 48pt floor via its horizontal length.

### 2. Local Verification on `395205a`

| Gate / Suite | Result |
| --- | --- |
| `npm run lint` (`expo lint`) | Exit 0 (0 errors, 0 warnings) |
| `npm run typecheck` (`tsc --noEmit`) | Exit 0 |
| `node scripts/verify-nxs-foundation.mjs` | Exit 0 (`2` interactive source files audited) |
| `node scripts/verify-no-release-secrets.mjs .` | Exit 0 (`36` files scanned) |
| `node scripts/verify-dependency-audit.mjs` | Exit 0 (`KNOWN_TOOLING_CHAIN_REQUIRES_EXPO_PATCH`: 0 critical, 1 high [`zod` / `GHSA-mrhx-c7xc-m3w5`], 10 moderate locally; Nov 10 CI run `42819932802` saw 12 moderate + 1 high) |
| `npx expo install --check` & `npx expo-doctor` (`688b7be`) | Up to date; `20/20 checks passed` |
| Auth test suites (`tests/*.test.mjs` on PR #6) | **50/50 pass** (RACE01-01..10 [10], R3-01..13 [13], ICR03-01..10 [10], RACE01-11..13 [3], STORE-08 [5], STORE-01..07/09/10 [9]) |

### 3. Advisory Root Clarification (`npm ls zod`)

Live lockfile and dependency inspection (`npm ls zod`) shows `zod@3.25.76` is introduced exclusively through the dev-only ESLint chain:
`eslint-config-expo@58.0.4` → `eslint-plugin-react-hooks@7.1.1` → `zod-validation-error@4.0.2` / `zod@3.25.76`. It is not imported by mobile application runtime code. Earlier wording attributing `zod` to `@expo/cli` is superseded by this lockfile observation.

### 4. Boundaries Unchanged

- **Root web `Quality` job (`.github/workflows/ci.yml`):** Non-blocking (`continue-on-error: true`), inherited pre-existing web debt outside mobile merge scope.
- **Branch protection & non-mobile PRs:** `main` currently has no active protection rules or rulesets (`404` / `[]`). Because `.github/workflows/tengasell-mobile-pr.yml` uses path filters (`mobile/**`, `docs/mobile/**`, `.github/workflows/tengasell-mobile-pr.yml`), requiring its check directly on `main` without an unconditional aggregator job would leave non-mobile PRs waiting indefinitely.
- **Physical Device UAT:** **BLOCKED** (no physical Android/iOS device attached; only Android emulator `emulator-5554` exists locally). Native hardware SecureStore/Keychain, TalkBack/VoiceOver, and 200% scaling remain uncertified on physical devices.
