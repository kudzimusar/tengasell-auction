# MOB-01-R3-DEP01 — SDK 58 Patch Compatibility Closure

- Parent source authority: `70c0397a827ff142cb9477d6cc53d9e50df7d552`
- Dedicated branch: `fix/tengasell-mobile-mob01-r3-sdk58-patch-alignment`
- Authority: the five specified Expo SDK 58 patch packages and one catalog fallback string only.
- The original R2 and the accepted R3 session source, including all thirteen regression tests, remain unchanged.

## Bounded patch graph

| Direct package | Before | After |
|---|---|---|
| expo | `~58.0.19` | `~58.0.21` |
| expo-constants | `~58.0.13` | `~58.0.14` |
| expo-linking | `~58.0.14` | `~58.0.15` |
| expo-router | `~58.0.26` | `~58.0.28` |
| expo-system-ui | `~58.0.6` | `~58.0.7` |

Expo CLI's supported installer resolved the five specs; only those direct dependencies changed in `mobile/package.json`. The generated `mobile/package-lock.json` included the expected nested dependency graph changes. No forced npm audit fix or SDK migration was performed.

## Unapproved additional compatibility drift

During the 30 October 2026 installer check, after upgrading those five packages, Expo's CURRENT validation baseline additionally required:

```text
react-native@0.88.0 - expected version: 0.88.1
```

The Moderator expressly authorized only five direct package updates and directed that a changed compatibility baseline be identified and reported. Therefore the sixth React Native patch **was not applied**. `npx expo install --check` and `npx expo-doctor` remain strict final gates; they must not be suppressed, excluded, or called successful while RN is mismatched.

## Security advisory comparison

| | Before | After |
|---|---:|---:|
| High | 3 | 3 |
| Low | 5 | 5 |
| Critical | 0 | 0 |
| Total | 8 | 8 |

No newly introduced high/critical advisory was detected. High advisories remain in `expo`, `@expo/cli`, and `zod` via the known tooling chain including `GHSA-mrhx-c7xc-m3w5`. Low advisories remain in `@expo/config`, `@expo/local-build-cache-provider`, `@expo/metro-config`, `@expo/prebuild-config` and `deepmerge`. This work contains no evidence of native runtime import/reachability of the CLI-only vulnerable path. No security issue is represented as resolved.

## Customer-facing copy

Only the residual catalog fallback value was changed to:

`We couldn't connect to TengaSell. Check your connection and try again.`

The key and `en` / `en-XA` / `ar-XB` translation mechanism remain unchanged.

## Certification boundary

CI exports are not physical iOS/Android certification. The Moderator must independently review this candidate and the newly surfaced React Native patch requirement before replacing any NXS acceptance authority. No Production deployment, schema mutation, PR merge or MOB-02 work was authorized or performed.
