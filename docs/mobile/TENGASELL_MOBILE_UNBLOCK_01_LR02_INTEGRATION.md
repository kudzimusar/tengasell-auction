# MOB-UNBLOCK-01-LR02 — integration receipt

**Assignment:** TENGASELL-MOBILE-01 — MOB-UNBLOCK-01-LR02 (supersedes LR01)
**Disposition:** REMEDIATE — continue to independent-review readiness
**Merge / release / Play upload:** NOT AUTHORIZED, and not performed
**Date:** 2026-11-10

---

## 1. Starting custody (INT-01)

```
repository   kudzimusar/tengasell-auction
main         98a607c3
PR #6 head   69b89133  base main
PR #7 head   1fd73a86  base PR #6
PR #8 head   5011c35f  base PR #7
working tree clean; no unrelated local changes
```

Stack preserved exactly as reviewed — no force-push, no squash, no rebase of
published branches. The three PRs remain Draft.

## 2. What LR01 left unexecuted

| LR01 obligation | State at LR02 start | LR02 action |
| --- | --- | --- |
| Mobile PR CI | absent | new blocking workflow (below) |
| SDK 58 convergence | partial (doctor drifting) | refreshed + drift documented |
| RACE01 pre-auth barrier | open | implemented + 10 tests |
| MOB-02 NXS closure | 44pt targets | 48pt + hitSlop + contract tests |
| MOB-03 socket ownership | open | epoch guard + 13 tests |
| REL isolation | combined | release packet separated (see §7) |
| Exact-head evidence | Oct-31 runs | new runs on current heads |
| Physical evidence | absent | **BLOCKED** — no device available |

## 3. Implementation changes

**RACE01 (`src/auth/login-barrier.ts` + provider).** Login previously awaited
`hasLogoutIntent()` *before* taking a generation: a logout during that read
incremented the generation, then the stale login incremented again and became
the newest owner — publishing a session after sign-out. Ownership is now taken
synchronously before the first await, rechecked after the intent read and after
authentication, and persistence stays generation-checked inside
`applyAuthenticated`.

**MOB-02 UX closure.** Primary targets raised to the NXS 48×48 floor (tab bar,
search input/button, chips, category tiles, item back/action bar); every custom
Pressable in an app route carries an explicit `hitSlop` review. The NXS static
check now audits 8 interactive source files (was 2).

**MOB-03 socket ownership (`connection-epoch.ts`, `socket.ts`).** Async connects
carry an ownership token; logout/account-switch/unmount invalidates it and a
late `connect` is torn down rather than resurrecting bidding. Bidding reconnects
when the session identity changes, not merely when the phase changes.

**Bid truthfulness (`bid-copy.ts`).** `ok` no longer implies leading. `outbid`
and `winning` are interpreted explicitly; the UI reports “You were outbid — the
standing bid is US$X” when a standing auto-bid covers the bid.

## 4. Mobile CI (INT-02)

`.github/workflows/tengasell-mobile-pr.yml` — blocking, no `continue-on-error`:

1. exact-head proof (`git rev-parse HEAD` = `github.sha`)
2. `npm ci`
3. NXS foundation static checks
4. dependency advisory policy
5. `expo install --check`
6. `expo-doctor`
7. `expo lint`
8. `tsc --noEmit`
9. R3 + RACE01 suites
10. navigation contract (when MOB-02 files exist)
11. socket safety (when MOB-03 files exist)
12. Android export
13. iOS export
14. clean working tree

Triggers: PRs to `main`, `fix/tengasell-mobile-*`, `feat/tengasell-mobile-*`;
pushes to those branches; manual dispatch. The obsolete `mob01`, `mob01-r3` and
`mob01-r3-dep01` workflows are retired to dispatch-only so no contradictory
requirement remains.

**Advisory policy.** Zero critical. A high is accepted only when every advisory
root is `GHSA-mrhx-c7xc-m3w5` (zod via the Expo CLI graph). Package-name
allow-listing was removed: it would hide future unrelated findings behind a
familiar label.

## 4a. Delivery state at handoff

| branch | head | PR | mobile gate |
| --- | --- | --- | --- |
| `fix/tengasell-mobile-r2-sdk58-patch-refresh` | `7847167` | #6 → `main` | **success** |
| `feat/tengasell-mobile-mob02-item-detail` | `a38b6ad` | #7 → #6 | **success** |
| `feat/tengasell-mobile-mob03-bidding-and-release` | `fd9301b` | #8 → #7 | **success** |

Each PR is independently green on its own head, not only at the top of the
stack. The three are ancestry-verified: `main` → #6 → #7 → #8, no force-push,
no rewritten history.

## 4b. Enforcement status — open item

`main` has **no branch protection and no rulesets** (`GET
/branches/main/protection` → 404; `GET /rulesets` → `[]`). The mobile workflow
fails the job honestly, but at merge level it is advisory: a reviewer can merge
past a red gate.

Enforcement was deliberately **not** switched on in this assignment, because it
would damage unrelated work:

1. `mobile/` does not exist on `main`; the workflow's early steps need it.
2. Two open PRs target `main` (#1 web authority barrier, #6 this stack).
   Requiring `mobile-gates` would leave the unrelated web PR permanently pending
   on a check that cannot run against a tree without `mobile/`.

Correct sequence: land #6 so `mobile/` exists on the base, then add a required
status check for `mobile-gates` on `main`. Recorded as **LR02-D9**, owner
action, not implementer action.

## 5. Tests (local, on the integrated candidate)

| Suite | Result |
| --- | --- |
| R3 logout continuity (13) | PASS |
| RACE01 login barrier (10) | PASS |
| MOB-02 navigation contract (7) | PASS |
| MOB-03 socket/bid contract (13) | PASS |
| **Total** | **43 / 43 PASS** |
| `expo-doctor` | 20 / 20 |
| `expo lint` | 0 errors (8 warnings) |
| `tsc --noEmit` | 0 errors |
| Android export / iOS export | PASS / PASS |

## 6. Defects found during LR02

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| LR02-D1 | P0 | Mobile CI absent on all three PRs | fixed (§4) |
| LR02-D2 | P0 | RACE01 pre-auth generation race | fixed + tested |
| LR02-D3 | P1 | 44pt targets below NXS 48 floor | fixed |
| LR02-D4 | P1 | Late socket connect could survive logout | fixed + tested |
| LR02-D5 | P1 | `ok` ack presented as leading | fixed + tested |
| LR02-D6 | P2 | Gate ran MOB-02/03 suites on the foundation PR | fixed (conditional) |
| LR02-D7 | P2 | Advisory policy keyed on package names | fixed (root-cause) |
| LR02-D8 | P2 | Item-screen conflict between touch fix and bid panel | resolved by superset merge |
| LR02-D9 | P1 | `main` unprotected — the gate reports but cannot block a merge | sequencing documented (§4b); owner action after #6 lands |
| LR02-D10 | P2 | Merge shipped unresolved conflict markers (`d179afe`) | fixed in `a59674e`; marker gate added to CI |
| LR02-D11 | P2 | MOB-02 head carried render-time `Date.now()` and sync `setState` | fixed in `ed8ef7f` |

## 7. REL-002 / REL-004 separation (INT-06)

Release signing and AAB evidence remain documented in
`TENGASELL_MOBILE_01_R4_RELEASE.md` and the `scripts/apply-release-signing.sh`
helper. They are reviewed as a **release domain**, not as bidding acceptance:
PR #8 carries the code, and its body labels the signing work as a separate
authority packet. No keystore, password or secret is committed; custody is
`~/.tengasell/android` (mode 600) with the password in the vault only.
**No Play upload, signing enrolment or production distribution was performed.**

## 8. Physical / runtime evidence (INT-08)

- Emulator (Pixel_8, Android 16) evidence exists for the earlier candidate
  `5011c35`: home, categories, item detail, sign-in, a live bid (auction 1015 →
  US$700, bid 445 active), account, SOLD band.
- **Not re-run on the delivered head** `0a4a0de`: no APK was rebuilt in this
  assignment (the owner deferred APK work to keep building functionality).
- **Physical device: BLOCKED** — no hardware available. SecureStore durability,
  VoiceOver/TalkBack, 200% text, pseudolocales and contrast remain unproven on
  hardware and are reserved to the independent reviewer.

## 9. Boundaries

- Merge to `main`: **NOT AUTHORIZED / not performed.**
- Play upload, signing enrolment, real-money operations: **NOT AUTHORIZED / not performed.**
- RACE01 security closure: implementer evidence only; **cannot self-certify.**
- MOB-04: scope and dependency preparation only (see handoff), no financial activation.

## 10. Root web CI classification (INT-10)

The repository-level `CI` workflow reports two jobs on the PR #6 head:

| job | result | meaning |
| --- | --- | --- |
| `Build and smoke test` | **success** | production build and endpoint probes pass |
| `Lint and typecheck (baseline debt — non-blocking)` | failure, `continue-on-error` | **inherited debt** |

Classification: **inherited, not introduced.** Evidence:

1. The job is declared `continue-on-error: true` on `main` already
   (`ci.yml`, “baseline debt — non-blocking”), so it never gates the merge.
2. Zero root application sources change in this PR. The complete set of
   non-`mobile/`, non-`docs/`, non-`.github/` changes is `.dockerignore`.
3. Current head reports `1101 problems (20 errors, 1081 warnings)`, which is
   therefore the state of `main` itself.

Not remediated here. Fixing 20 web errors inside a mobile PR would widen the
diff past what a reviewer can attribute, and the Moderator’s scope is the
mobile programme. It is recorded as debt with an owner decision outstanding.

## 11. Independent review still required

1. RACE01 source and security acceptance.
2. Full-scope review of PR #6 (37 commits, 49 files, +17,447 lines — see the
   A/B/C/D scope table in the PR body; review A, not the incremental patch).
3. Physical-device certification (SecureStore, assistive tech, text scaling, pseudolocales).
4. NXS touch/adaptation evidence on hardware.
5. Merge-strategy approval for the three-PR stack.
6. Disposition of the inherited web lint debt (§10) — separate change, not this one.
