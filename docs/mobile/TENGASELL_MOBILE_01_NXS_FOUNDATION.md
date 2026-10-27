# TENGASELL-MOBILE-01 — NXS 1.0 Foundation Authority

**Framework:** 11-11 Tech NXS — Native Experience System 1.0, Pilot Release  
**Programme:** TENGASELL-MOBILE-01  
**Work unit:** MOB-01-R1  
**Implementation:** React Native / Expo SDK 58  
**NXS role:** Governing native presentation and interaction authority. It does not alter backend behavior, product policy, authentication authority, data ownership, security policy or commercial rules.

## NXS foundation implemented in MOB-01

- Version-controlled `mobile/nxs-experience-manifest.yaml`.
- Semantic token foundation under `mobile/src/nxs/` for touch, spacing, radius, typography, surfaces, actions and runtime states.
- Normal custom touch floor: **48×48 logical units**.
- Window-derived compact / regular / wide context; no named-device layout authority.
- Safe-area, font-scale, writing-direction, platform and color-scheme context.
- Automatic light/dark semantic theme resolution.
- Orientation unlocked so the shell can be verified in portrait and landscape.
- Expo Router remains the route authority; native stack/back behavior is retained.
- Authentication remains canonical TrailBase through gateway `XTransformPort=3001`.
- Haptics and voice are explicitly **off** for MOB-01 rather than simulated.
- Expressive energy is disabled for the foundation; hierarchy, reachability and recovery take precedence over decoration.

## Navigation contract

| Route | Entry | Exit / continuation | Back | Restore | Deep-link requirement | Top-level |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | App launch, `tengasell://` | Sign in, Account, category selection | Platform exit when root | Selected category and list remain while route stays mounted | Reconstruct anonymous/authenticated shell from session authority | Yes |
| `/auth/login` | Home Sign in, direct route | Successful login replaces with Account; degraded state can retry/clear | Returns prior native stack context when pushed from app | Entered values remain through validation/network failure while mounted; password is never persisted to storage | Must render safely without prior route state | Contextual |
| `/account` | Home Account, post-login replace, direct route | Retry profile, sign out | Returns prior native stack context when available | Session restored from SecureStore before protected request | Direct entry must restore session or redirect to login | Contextual |

## State contract — MOB-01

| Surface | Initial/loading | Populated | Empty/partial | Offline/degraded | Recoverable error | Unrecoverable/session-invalid | Success |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home browse | Explicit canonical-authority loading | Live category/auction records | Empty auction state with useful recovery action | Canonical authority unavailable; no demo authority | Retry connection / retry list | Configuration error remains explicit | Connected state text |
| Login/session | Secure-session recovery | Anonymous login form / authenticated redirect | n/a | Session recovery retry + local clear | Wrong credentials preserve entered identifier/password | Invalid stored session clears privileged state | Authenticated route transition |
| Account | Authenticated profile loading | Profile + TrailBase identity | Missing profile is labelled as partial data, not silently invented | Retry session or sign out locally | Retry authenticated profile request | Redirect to login after invalidation | Authenticated authority status |

## NXS verifier matrix for this foundation

Independent verification should at minimum exercise:

- Compact phone + 200% text + keyboard visible.
- Expanded tablet + landscape.
- RTL runtime/layout-direction stress and expanded pseudolocalization.
- Screen reader + loading/degraded live-region announcements.
- Offline + partially entered login form + return.
- Slow network + repeated sign-in tap attempt; duplicate submission must remain prevented.
- Tall phone + one-handed reach for Sign in, Retry and Sign out.
- Light/dark theme semantics and non-color error/warning meaning.
- Native back behavior from Login and Account on both iOS and Android.

## Certification boundary

This file is implementer evidence, not NXS certification. Physical device interaction, max text scaling, VoiceOver/TalkBack, pseudolocalization/RTL, contrast, platform-native behavior and performance require independent evidence. Final NXS disposition remains `CERTIFIED | REMEDIATE | BLOCK` under the NXS Moderator.
