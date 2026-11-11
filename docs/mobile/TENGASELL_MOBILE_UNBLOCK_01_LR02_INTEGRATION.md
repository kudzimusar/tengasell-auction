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

## 4a. Delivery state at the LR02 handoff — HISTORIC CHECKPOINT

> These are the heads as delivered by LR02. They are kept for history and are
> **not** current. The authoritative register for the closeout is §12; consult it
> before quoting any SHA from this table.

| branch | head | PR | mobile gate |
| --- | --- | --- | --- |
| `fix/tengasell-mobile-r2-sdk58-patch-refresh` | `7847167` | #6 → `main` | **success** |
| `feat/tengasell-mobile-mob02-item-detail` | `a38b6ad` | #7 → #6 | **success** |
| `feat/tengasell-mobile-mob03-bidding-and-release` | `fd9301b` | #8 → #7 | **success** |

Each PR is independently green on its own head, not only at the top of the
stack. The three are ancestry-verified: `main` → #6 → #7 → #8, no force-push,
no rewritten history.

## 4b. Enforcement status — open item (superseded by §12.6)

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
2. Full-scope review of PR #6 (49 files, +17,447 lines — see the A/B/C/D scope
   table in the PR body; review A, not the incremental patch). The commit count
   is not a stable measure here: the stack is reconciled by merge commits, so it
   grows as units land.
3. Physical-device certification (SecureStore, assistive tech, text scaling, pseudolocales).
4. NXS touch/adaptation evidence on hardware.
5. Merge-strategy approval for the three-PR stack.
6. Disposition of the inherited web lint debt (§10) — separate change, not this one.

---

# 12. LR03 — engineering closeout

**Assignment:** MOB-UNBLOCK-01-LR03 (bounded closeout; no restart, no MOB-04).
**Disposition:** REMEDIATE — corrections delivered, independent review performed,
merge and release remain Owner decisions.

## 12.1 Custody at LR03 start

| unit | stated SHA | observed | result |
| --- | --- | --- | --- |
| PR #6 | `59d72ec4` | `59d72ec4` | match |
| PR #7 | `29d27c35` | `29d27c35` | match |
| PR #8 | `4e7e3853` | `4e7e3853` | match |

Ancestry `main → #6 → #7 → #8` verified with `git merge-base --is-ancestor`.
Working tree clean; no unrelated local work. Two stashes inspected, not deleted:
`stash@{0}` “audit policy” is byte-identical to the committed gate script;
`stash@{1}` “LR02 work split” is based on `5011c35` (an ancestor) and every delta
is superseded by accepted work — its largest deletions are the pre-SDK-58
`package-lock.json` and the pre-fix `item/[id].tsx`.

## 12.2 Corrections delivered in LR03

| checkpoint | change | commit |
| --- | --- | --- |
| CLOSE-01 | ack truthfulness: four-state presenter; missing `winning` never means lead; missing/invalid amount never rendered; contradictory flags → unknown; timeout/disconnect/malformed → uncertain and reconciled, never “rejected”, never retried | `aae9151`, `182369b` |
| CLOSE-02 | session-safe completion: `runGuardedBid` takes session generation + identity + connection epoch synchronously and publishes only if all three still hold | `aae9151` |
| CLOSE-03 | independent review performed (see 12.3); D1 and two further defects found and fixed | `916eed1`, `182369b` |
| CLOSE-04 | CI provenance: source head, base head, tested merge SHA and workflow head recorded per run | `f1c0aab` |
| CLOSE-05 | gates preserved and extended (18 steps), advisory policy root-cause based | `f1c0aab`, `916eed1` |
| CLOSE-06 | this receipt, corrected against the actual heads | — |
| CLOSE-07 | full PR #6 review register, 52-file register pinned to `916eed1` | `f1c0aab` |
| CLOSE-08 | governance finding + exact owner action (12.6) | — |
| CLOSE-09 | physical classification (12.7) | — |
| CLOSE-10 | release-secret gate; release records kept, no secret in source | `f1c0aab` |

## 12.3 Independent review outcome

Two independent reviews were performed against source (not against this
receipt), by a reviewer that did not author the changes.

**RACE01 security review — verdict REMEDIATE, then remediated.**

| item | verdict |
| --- | --- |
| stale login can no longer publish | PASS |
| ownership acquired before first await | PASS |
| logout invalidates the older operation | PASS |
| credential persistence rejects stale ownership | **FAIL → fixed** |
| authenticated publication rejects stale ownership | PASS |
| restoration is fail-closed | PASS |
| SecureStore failures not converted into a safe state | PASS |
| fresh login still works after logout | PASS |
| no equivalent switching race introduced | PASS |

Defect **D1**: `applyAuthenticated` wrote the credential pair, then re-checked
generation ownership and threw — leaving the bytes stored. Had the newer owner
been a login that later failed, the next cold start would have restored the
superseded account. Fixed in `916eed1`: the stale branch deletes its own write,
keyed on the auth token it wrote, so a newer owner's credentials are never
discarded and a logout (which clears independently) is unaffected. Covered by
RACE01-11…13.

Residual gap, disclosed: the RACE01 suite drives the production barrier module
and the production storage driver, but no test renders `SessionProvider`; the
provider wiring is reviewed by inspection only.

**Bid-state review — verdict REMEDIATE, then remediated.**

| item | verdict |
| --- | --- |
| `ok` alone never yields a success message | PASS |
| missing `winning` not treated as true | PASS |
| missing amount never rendered as US$0 | PASS |
| contradictory flags never succeed | PASS |
| malformed ack yields an explicit unknown state | **FAIL → fixed** |
| timeout/drop uncertain, not rejection, not retried | PASS |
| stale completion cannot publish into current UI | PASS |
| guard reuses existing authorities, no second session authority | PASS |
| busy state cannot deadlock after a discard | PASS |
| PR #6 register actually presents the full candidate | PASS |

Defect: `placeBid` collapsed a reply without a boolean `ok` into `ok:false`
(`Boolean(undefined)`), which the presenter then rendered as “The bid was not
accepted.” for a command the engine may already have executed. Fixed in
`182369b` by extracting the contract into `src/lib/bid-ack.ts`: a non-boolean
`ok` is uncertain/malformed; non-boolean flags stay unknown. Second finding:
the item screen read `session.identity` from the press-time closure, so the
identity guard could not see a later switch; it now reads a live ref.

## 12.4 Test register

| suite | tests | where it runs |
| --- | --- | --- |
| R3 logout continuity | 13 | all layers |
| RACE01 barrier | 10 | all layers |
| RACE01 stale-write cleanup | 3 | all layers |
| MOB-02 navigation | 7 | #7, #8 |
| MOB-03 socket/bidding | 13 | #8 |
| CLOSE-01 acknowledgement | 10 | #8 |
| CLOSE-02 completion ownership | 9 | #8 |
| **per layer** | **#6 26 · #7 33 · #8 65** | |

All passing on the recorded runs (12.5). This exceeds the previous 43.

## 12.5 CI provenance (the four identities)

Measured at the LR03 code freeze. On a `pull_request` event the tested tree is
GitHub's generated merge commit, which is **not** the branch source head:

| PR | source head | base head | tested merge | run | job | tests | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #6 | `916eed1` | `98a607c3` | `b326adb7` | 42787961705 | 129733851830 | 26 | success |
| #7 | `6d06da0` | `916eed1` | `368eda37` | 42787969250 | 129733877163 | 33 | success |
| #8 | `2edfe70` | `6d06da0` | `78f96a03` | 42787976410 | 129733905569 | 65 | success |

Workflow head equals the tested merge SHA in every run. The earlier gate
compared `git rev-parse HEAD` with `github.sha`, which proved the merge commit
was checked out while reading as if it proved the source head; the four values
are now recorded separately and published to the job summary.

## 12.6 Governance — required checks

Measured: `GET /branches/main/protection` → 404; `GET /rulesets` → `[]`;
`GET /rules/branches/main` → `[]`. **`main` has no protection of any kind.** The
mobile gate is therefore *blocking by design* (no `continue-on-error`) but
*advisory in effect*: a reviewer can merge past a red run. PR #6 also reports
`mergeable_state: unstable` solely because of the non-blocking web lint job.

Exact Owner action, in this order:

1. Land PR #6, so `mobile/` exists on the base.
2. Make the workflow safe for non-mobile PRs — today it would fail on a tree
   without `mobile/package-lock.json`. Add a always-running `scope` job that
   detects whether the PR touches `mobile/**`, and a small `mobile-gates`
   aggregator job that succeeds for non-mobile PRs and otherwise requires the
   full job. Without this step, requiring the check would strand the unrelated
   web PRs (#1–#5).
3. Create a ruleset for `main` requiring the aggregator check plus one review,
   with no admin bypass:

```bash
gh api -X POST repos/kudzimusar/tengasell-auction/rulesets \
  -f name="main-protection" -f target=branch -f enforcement=active \
  -f 'conditions[ref_name][include][]=~DEFAULT_BRANCH' \
  -f 'rules[][type]=pull_request' \
  -f 'rules[][type]=required_status_checks'
```

(Parameter shape must be confirmed with `gh api` dry-run before execution; the
repository admin owns this change.)

Not performed here: repository-wide governance is outside this assignment, and
absence of required checks is not a reason to merge early.

## 12.7 Physical evidence

Unchanged and not inferable from CI:

```text
PHYSICAL ANDROID — BLOCKED
PHYSICAL IOS — BLOCKED
NATIVE SECURESTORE — NOT CERTIFIED
VOICEOVER/TALKBACK — NOT CERTIFIED
NXS PHYSICAL ADAPTATION — NOT CERTIFIED
```

Emulator evidence from `5011c35` (bid US$700 on auction 1015) belongs to that
candidate only. No APK was rebuilt in LR03 (Owner pause). Android and iOS
*bundle exports* succeed in CI, which is build-level evidence, not device
evidence.

## 12.8 Release authority

REL-002/REL-004 remain a separate domain carried in PR #8 documentation:
keystore custody outside the repository, no secret in source, no signed artefact
claimed for the current source, no Play upload or signing enrolment. The
`verify-no-release-secrets` gate now fails a PR that introduces a key block,
a `storePassword`/`keyPassword` literal, a keystore reference or a
`TGS_KEYSTORE_PASSWORD` assignment into `src`, `app`, `scripts`, `tests` or CI.

## 12.9 Merge readiness and Owner decisions

| PR | engineering | merge |
| --- | --- | --- |
| #6 | complete; gate green (26 tests) | requires full-scope review + required-check decision |
| #7 | complete; gate green (33 tests) | requires #6 acceptance |
| #8 | complete; gate green (65 tests) | requires #6/#7 acceptance and commercial review |

Owner decisions outstanding: (1) required-check roll-out per 12.6; (2) physical
UAT scheduling; (3) merge order and whether the stack lands as three PRs;
(4) disposition of inherited web lint debt; (5) whether an external human
security reviewer is required beyond the independent agent review in 12.3.

---

# 14. ICR02 — atomic credential ownership (final security gate)

**Assignment:** MOB-LR03-ICR02. **Disposition:** REMEDIATE → corrected → independent
ACCEPT.
**Accepted custody:** `385490c` / `d92f230` / `e7030c3`, each verified as an
ancestor of the branch head before any mutation. Work continued on those branches;
no force-push, no rebase, no new stack.

## 14.1 The defect, reproduced before it was fixed

The LR03 stale cleanup was a compare-and-delete split across awaits:

```ts
const current = await driver.read(AUTH_TOKEN_KEY);   // ownership check
if (current !== tokens.authToken) return false;
await clearStoredSession();                          // delete both slots
```

A newer login could persist a valid pair between those statements and have it
erased. STORE-01 reproduced it against the production storage logic with an
injected asynchronous driver, before any change was made:

```text
AssertionError: the newer login's auth token was deleted by the stale cleanup
  actual:   undefined
  expected: 'login-b'
```

## 14.2 Root causes and correction

| id | defect | correction |
| --- | --- | --- |
| ICR02-D1 | compare-then-delete window erased a newer login's pair | credential operations run on one serialized queue inside the storage authority; read, compare, mutate and verify are indivisible |
| ICR02-D2 | pair write used `Promise.all`: the first rejection ended the queued operation while the sibling write was still pending, so it escaped the queue and could pair one account's auth token with another's refresh token | both writes settle via `allSettled` before the operation decides; no write outlives its queue slot |
| ICR02-D3 | a failed write whose cleanup also faulted left a restorable partial pair | the durable sign-out marker is set before rethrowing, so restoration fails closed |

**The sign-out marker is deliberately not queued.** R3 requires the intent to be
writable and observable while a credential write is paused — that is how "intent
wins over late persistence" works. Queueing it deadlocked R3-07 during
development; the boundary is credential slots only.

**Publication is now testable.** `applyAuthenticated` moved to
`src/auth/session-orchestrator.ts`; `SessionProvider` delegates to it, so
STORE-08 drives the production ordering rather than a twin.

## 14.3 Tests added

| suite | tests | ids |
| --- | --- | --- |
| storage concurrency | 9 | STORE-01…07, STORE-09, STORE-10 |
| provider orchestration | 5 | STORE-08 (published / superseded / already-lost / malformed / cleanup-failure) |

STORE-09 and STORE-10 were each verified to fail against the pre-fix form and
pass against the correction, so they are reproductions rather than restatements.
STORE-01 likewise fails against the LR03 implementation.

## 14.4 Independent review history

| source | verdict | finding |
| --- | --- | --- |
| `bb151da` | REMEDIATE | `Promise.all` pair write let a sibling write escape the queue; mixed pair restorable (ICR02-D2) |
| `0de0123` | ACCEPT + residual note | failed write with faulted cleanup left a restorable partial pair (ICR02-D3) |
| `937fcc3` | **ACCEPT, no defects** | residual closed; no write outlives its operation; no queue cycle; 79/79 |

## 14.5 Evidence at the ICR02 freeze

| PR | source head | base head | tested merge | run | job | tests |
| --- | --- | --- | --- | --- | --- | --- |
| #6 | `937fcc3` | `98a607c3` | `db1f75a1` | 42804523279 | 129790163016 | 40 |
| #7 | `1e6fc9a` | `937fcc3` | `8b44e073` | 42804531155 | 129790189830 | 47 |
| #8 | `d064e0d` | `1e6fc9a` | `4b601a29` | 42804534045 | 129790199376 | 79 |

All success. Full battery 79/79 locally; lint 0 errors; `tsc` 0; doctor 20/20;
Android and iOS export pass; release-secret scan 45 files clean.

## 14.6 Residual gaps

- The `SessionProvider` wrapper that tracks the in-flight write (`session-context.tsx`)
  is not itself tested; the orchestration it calls is. Disclosed, not claimed.
- Everything above is an in-memory driver. **No native SecureStore evidence** is
  claimed, and none of it substitutes for physical certification.

## 14.7 Unchanged boundaries

Merge, Play upload, signing enrolment and production remain unauthorized and
unperformed. Branch protection remains an Owner action (§12.6). Physical
certification remains blocked (§12.7).


---

## 15. `MOB-01-ICR03-LR01` — Three-PR Stack Certification & Merge-Readiness Addendum

### 15.1 Stack Custody Remediation (PR #7 Leak & PR #8 Auto-Merge Incident)

Prior to `ICR03-LR01`, while checking out `feat/tengasell-mobile-mob02-item-detail` (`07f5f60`), an unintended merge pulled `origin/feat/tengasell-mobile-mob03-bidding-and-release` into PR #7 (`d24a0bf`), followed by `acaf47b`, `f104e31`, and `67b3560`:

- **Symptom 1:** PR #7 expanded to `22` files (`+2,542 / −56`) and executed MOB-03 bidding test suites (`bid-*`, `socket-*`).
- **Symptom 2:** Because `feat/tengasell-mobile-mob03-bidding-and-release`'s remote head (`d24a0bf`) became an ancestor of PR #8's base branch (`feat/tengasell-mobile-mob02-item-detail`), GitHub automatically marked Draft PR #8 as **`MERGED`** at `2026-11-10T12:53:08Z` (`mergeCommit.oid = d24a0bfd27f60ec8ebfa47bdca256f00b45a780f`) even though `main` remained untouched at `98a607c3`.

**Non-destructive resolution (zero force-push, zero history rewrite):**

1. **PR #6 (`fix/tengasell-mobile-r2-sdk58-patch-refresh` → `main`):** Remediated at code commit `395205a` (+ doc sync follow-up) with `ICR03-D2`, `ICR03-10`, `clearLocalSession`/`refreshSession` generation hardening, and smallest-axis `verify-nxs-foundation.mjs` (`57` files vs `main`, `50/50` auth tests).
2. **PR #7 (`feat/tengasell-mobile-mob02-item-detail` → `fix/tengasell-mobile-r2-sdk58-patch-refresh`):** Cleanly reverted the leaked MOB-03 merge (`git revert -m 2 d24a0bf` → `8c3be94`), merged PR #6 fixes forward, and resolved clean MOB-02 defects at `4660ffa`: expired live lots closed (`remainingMs <= 0`), `minNextBid` tiered next minimum displayed, responsive `useWindowDimensions()` hero width, `retry`/`All`/`Try again`/`Sign in` 48pt minimum touch targets, and `categories.tsx` `categoryRequestRef` sequencing (`12` clean files vs PR #6, `57/57` tests).
3. **MOB-03 (`feat/tengasell-mobile-mob03-bidding-and-release` → `feat/tengasell-mobile-mob02-item-detail`, superseded into Draft PR #9):** Reconciled `8c3be94` with `-s ours` so MOB-03 files were preserved, merged PR #7 clean fixes (`16e3b21`), reset per-listing state cleanly on `id`/identity transitions, aligned `search.tsx` (`d42d8d4`), giving an exact `11`-file MOB-03 scope (`+1,380 / −28`) and **`92/92` passing tests** (`50` auth + `7` navigation + `13` ACK + `9` BID + `13` socket). Because GitHub cannot reopen a `MERGED` PR (#8), Draft PR #9 replaces PR #8 for final stack review.

### 15.2 Advisory Reconciliation Summary

| Observation Point | Critical | High | Moderate | Root Explanation |
| --- | ---: | ---: | ---: | --- |
| GitHub CI `42819932802` (`2026-11-10T12:56:47Z`) | 0 | 1 | 12 | `zod` (`GHSA-mrhx-c7xc-m3w5`); `glob`, `minimatch`, `@expo/cli`, `@expo/fingerprint`, `expo`, `@typescript-eslint/*`, `eslint-config-expo`, `eslint-plugin-expo` |
| Local Verification (`2026-11-11`) | 0 | 1 | 10 | `npm ls zod`: `eslint-config-expo@58.0.4` → `eslint-plugin-react-hooks@7.1.1` → `zod@3.25.76` (dev/lint only); `eslint-config-expo`/`eslint-plugin-expo` advisories absent in current GitHub Advisory DB snapshot |

### 15.3 Branch Protection Sequence (Do Not Enable Before Prep)

Before enabling GitHub Branch Protection / Rulesets on `main`:

1. Keep `.github/workflows/tengasell-mobile-pr.yml` non-bypassable for `mobile/**` PRs, **and** add an unconditional workflow/aggregator check (or split path-filter inside jobs) so non-mobile PRs to `main` still report a green required status instead of stalling at *"Expected — Waiting for status to be reported"*.
2. Enable protection only with Owner sign-off: require PR before merging, require 1 approving review, require the unconditional status check(s), disallow force-push and branch deletion, and enforce ordered stack merge (**PR #6 → retarget PR #7 to `main` → PR #7 → retarget PR #9 to `main` → PR #9**).

### 15.4 Controlled Merge & Rollback Protocol

- Merge only when PR checks match exact current `HEAD` SHAs on GitHub Actions.
- Keep all PRs **Draft** until Owner completes Physical UAT (below) or formally waives hardware blocks for internal beta/test track progression.
- After merging PR #6 (`main` advances), retarget PR #7 base to `main`, merge `main` into PR #7 if needed (trivial fast-forward/merge since `PR #6` is already an ancestor), re-run CI to green, merge PR #7, then repeat for PR #9.
- Rollback strategy: single-merge revert commit on `main` (`git revert -m 1 <merge_sha>`); keep Expo SDK 58 native runtime changes isolated from web root builds; never rebuild or promote APK/AAB until Owner resumes REL-004 build work.

### 15.5 Owner-Executable Physical Device UAT Procedure (Outstanding Block)

1. Provision a real Android handset (Android 12+) and a real iPhone (iOS 16+) pointed at staging/tunnel (never unapproved Production mutation).
2. **Cold-start & Auth / Logout / Switch Matrix (`PR #6`):** Sign in (`@nyasha`), verify SecureStore/Keychain persistence across force-quit, tap Sign out offline & online, confirm logout barrier blocks stale token resurrection, switch to a second account (`@tendai`), confirm stale profile/refresh responses never appear.
3. **Accessibility & Viewport (`PR #7`):** Enable **200% OS font size / Dynamic Type** + **TalkBack (Android) / VoiceOver (iOS)** across Home, Categories, Search, Item Detail, Orders, and Account; verify zero clipped prices/CTAs, zero horizontal overflow, responsive square hero image on narrow/tablet screens, and `>=48pt` tap targets on `All`, `Try again`, `Sign in`, `Back`.
4. **Live Bidding (`PR #9`):** On an open staging lot, place an opening/challenger bid (`winning: true`), have `@tendai` hold a higher standing auto-bid (`outbid: true`), disconnect airplane mode mid-bid (`uncertain: true` -> state reconciliation), confirm closing countdown hits `Ends in 0s` -> `Auction closed` without restart.
5. **MOB-04 Payments/Push Handoff:** Do **not** start MOB-04 until PR #6, PR #7, and PR #9 are merged cleanly to `main` and physical device UAT signs off auth/session isolation and bidding truthfulness (`bids` / `auctions` mutations remain exclusively behind Trade Engine Socket.IO `:3002`).
