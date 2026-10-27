# TENGASELL-MOBILE-01 — MOB-01-R2 Dependency Security Triage

**Scope:** bounded dependency-security return only  
**Authority:** MOB-01-R2  
**Audit evidence:** GitHub Actions run `40468330471`, artifact `mob01-r2-npm-audit`  
**Policy:** no blind `npm audit fix --force`

## Finding

The reported **3 high-severity npm audit entries are one dependency chain**, not three independent application defects:

```text
expo 58.0.19 (direct project dependency)
  └─ @expo/cli 58.1.15 (transitive Node CLI/tooling dependency)
       └─ zod 3.25.76 (transitive)
            GHSA-mrhx-c7xc-m3w5
            affected: < 4.6.6
            CWE-770 / memory exhaustion
```

| Package | Direct / transitive | Installed | Audit relationship | Reachability classification | R2 disposition |
| --- | --- | --- | --- | --- | --- |
| `expo` | Direct | `58.0.19` | npm marks affected because it depends on affected `@expo/cli` | Expo is a runtime framework dependency, but this advisory path is through its bundled Node CLI dependency | Keep SDK 58; monitor Expo patch |
| `@expo/cli` | Transitive through `expo` | `58.1.15` | affected through `zod` | Build/development CLI; not imported by Tengasell app source | Known tooling exposure; no forced override |
| `zod` | Transitive through `@expo/cli` | `3.25.76` | GHSA-mrhx-c7xc-m3w5, `<4.6.6` | Node CLI validation path; no import from `mobile/src` | Await Expo-compatible CLI dependency update |

## Patched-version analysis

At R2 implementation time, the SDK-58 package graph resolves `expo@58.0.19` and `@expo/cli@58.1.15`. The CLI declares `zod ^3.25.76`, which cannot resolve the advisory's patched `4.6.6+` line.

`npm audit` reports a force-fix target of `expo@54.0.38` and marks it a SemVer-major change. That would violate the accepted Expo SDK 58 / React Native 0.88 foundation and is therefore **not an authorized remediation**.

No Expo-SDK-58-compatible patched package is currently established by this audit. The correct remediation lane is to adopt an Expo 58 patch when Expo publishes one that updates the CLI/Zod chain, then rerun Doctor, lint, typecheck, exports and audit.

## Actual mobile runtime exposure

No Tengasell runtime source imports `@expo/cli` or `zod`. The R2 NXS static gate fails if either package becomes imported under `mobile/src`. The installed root Zod instance is also deduped into other Node tooling paths (including lint/tooling dependencies), but npm audit records the vulnerable effect chain through `@expo/cli`; this does not establish native bundle reachability.

This means:

- **native-app runtime reachability is not demonstrated** by current evidence;
- **Node build/development tooling exposure remains real** while the affected CLI dependency is installed;
- this is a known release-governance risk, not grounds to downgrade or break the accepted SDK foundation.

## Disposition

`KNOWN_EXPO_TOOLING_ADVISORY — MONITOR_AND_PATCH_WITHIN_SDK_58`

This is not a security certification and does not waive future dependency review.
