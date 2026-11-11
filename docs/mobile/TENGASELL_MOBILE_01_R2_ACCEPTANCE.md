# MOB-01-R2 — acceptance evidence (implementer side)

**Unit:** MOB-01-R2 (NXS Foundation Convergence)
**Candidate:** `3b373ea` + dependency alignment `5c45c51`
**Branch:** `fix/tengasell-mobile-r2-sdk58-patch-refresh`
**Run:** 2026-11-10, isolated worktree at the exact candidate (not a working tree with newer work)
**Status:** READY_FOR_VERIFICATION — implementer evidence only. Disposition reserved to the NXS Moderator.

---

## 1. Why this run happened

The programme names **MOB-01-R2** as the current unit and states that MOB-02+ commercial/product
expansion remains unauthorized until R2 is accepted. Acceptance therefore has to run against the
**exact candidate**, not against newer branches.

## 2. Battery and results

| # | Check | Command | Before | After alignment |
| ---: | --- | --- | --- | --- |
| 1 | Dependency integrity | `npx expo-doctor` | **✗ 1 check failed** (6 packages behind SDK 58) | **✓ 20/20 passed** |
| 2 | Types | `npm run typecheck` | ✓ 0 errors | ✓ 0 errors |
| 3 | Lint | `npm run lint` | ✓ 0 | ✓ 0 |
| 4 | NXS foundation static checks | `node scripts/verify-nxs-foundation.mjs` | ✓ "2 interactive source files audited" | ✓ |
| 5 | Android bundle | `npx expo export --platform android` | ✓ | ✓ |

### Finding 1 — SDK 58 patch drift (blocking, fixed)

`expo-doctor` reported six packages behind the expectations current on 2026-11-10:

```
expo                            58.0.21 -> 58.0.23
expo-linking                    58.0.15 -> 58.0.16
expo-router                     58.0.28 -> 58.0.30
react-native-safe-area-context  5.10.1  -> 5.11.1
react-native-screens            4.30.0  -> 4.30.1
```

The DEP01 gate passed on 2026-10-31 against the registry state of that day. This is **registry
drift**, not a regression in the candidate: the same commit that passed then fails now. Aligned
with `npx expo install --fix`; doctor is 20/20 and every other check still passes.

This is a standing risk for any "strict doctor" gate: it validates against a moving upstream.

## 3. NXS foundation coverage (claimed, per the authority document)

| Requirement | Evidence |
| --- | --- |
| Version-controlled experience manifest with strict certification | `mobile/nxs-experience-manifest.yaml` |
| Semantic tokens (touch, spacing, radius, type, surface, action, state, motion) | `mobile/src/nxs/tokens/` |
| 48×48 logical touch floor | static check + token assertions |
| Window-derived compact/regular/wide (no named-device authority) | `NxsProvider` window class |
| Safe area, font scale, orientation, theme, writing direction | provider context |
| Keyboard visibility, network state, reduce motion, screen reader | provider context |
| Platform contrast / reduced transparency normalisation | provider context |
| Explicit loading / empty / partial / degraded / recoverable-error states | home + account state tables |
| Haptics, voice, expressive energy **off** in foundation | manifest + provider |
| English only at launch | manifest + catalog |

## 4. Not performed here (independent / physical evidence owed)

- Physical-device interaction, touch latency and reachability.
- 200% text scaling and keyboard-visible layouts.
- VoiceOver / TalkBack traversal.
- Pseudolocale (`en-XA`) and RTL (`ar-XB`) rendering.
- Contrast measurement in both themes.
- Cold-start performance and frame stability.

CI exports are **not** physical certification.

## 5. Consequence for the programme

1. With `5c45c51` applied, the R2 battery is green and ready for Moderator review.
2. MOB-02 (item detail, mobile cards, five-tab navigation) and MOB-03 (live bidding) exist as
   branches but remain **unauthorized** by the plan until R2 is accepted.
3. Merging those two branches is what moves the app from "foundation shell" to a usable
   marketplace; that is the correct next step after acceptance — not new feature code.
