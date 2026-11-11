# TENGASELL-MOBILE-01 — NXS 1.0 Foundation Authority

**Framework:** 11-11 Tech NXS — Native Experience System 1.0, Pilot Release  
**Programme:** TENGASELL-MOBILE-01  
**Current work unit:** MOB-01-R2  
**Implementation:** React Native / Expo SDK 58  
**NXS role:** governing native presentation and interaction authority. NXS does not alter backend behavior, product policy, authentication authority, authorization, data ownership, security policy or commercial rules.

## NXS sources every future mobile unit must consume

```text
mobile/nxs-experience-manifest.yaml
mobile/src/nxs/
docs/mobile/TENGASELL_MOBILE_01_NXS_FOUNDATION.md
```

## Foundation implemented

- Version-controlled NXS 1.0 experience manifest with strict certification.
- Semantic token foundation for touch, spacing, radius, typography, surfaces, actions, state and motion.
- Normal custom touch floor: **48×48 logical units**.
- Window-derived compact / regular / wide context; no named-device layout authority.
- Safe-area, font-scale, orientation, platform, theme and writing-direction context.
- Runtime keyboard visibility.
- Runtime network state: online / offline / degraded / unknown.
- Runtime reduce-motion and screen-reader state.
- Platform-specific contrast preference normalized as increased / standard / unknown.
- iOS reduced-transparency state; explicitly unknown where the platform does not expose a corresponding reliable signal.
- Automatic light/dark semantic theme resolution.
- Adaptive portrait/landscape operation.
- Expo Router route authority and native stack/back behavior.
- Canonical TrailBase authentication through gateway `XTransformPort=3001`.
- Explicit loading, empty, partial, degraded and recoverable-error states.
- Reduced-motion navigation removes nonessential stack animation when the system preference is enabled.
- Haptics and voice remain explicitly **off** in MOB-01.
- Expressive energy remains disabled in the foundation.

## Localization authority

English remains the only launch locale in MOB-01-R2. All MOB-01 route/component strings are sourced from:

`mobile/src/nxs/localization/catalog.ts`

Development/certification pseudolocales are selected at bundle/runtime configuration through:

```bash
EXPO_PUBLIC_NXS_LOCALE=en-XA   # expanded LTR
EXPO_PUBLIC_NXS_LOCALE=ar-XB   # RTL stress mode
```

The default or any unsupported value resolves to English.

Pseudolocalization transforms resource templates **before placeholder interpolation**. Dynamic product/domain values therefore remain literal, including auction titles, category names, usernames, prices, IDs and unknown backend messages. Known Tengasell/TrailBase client messages are mapped to string-resource keys; unknown server/domain text is deliberately preserved rather than mechanically translated.

RTL stress mode changes the NXS effective writing direction and route/component alignment/order. Direction-neutral photographs are repositioned by layout when appropriate but their image content is never mirrored.

## Environment contract

| Dimension | MOB-01-R2 source | Truth behavior |
| --- | --- | --- |
| Platform | React Native `Platform.OS` | iOS / Android / other |
| Viewport + window class | `useWindowDimensions` | compact / regular / wide from actual width |
| Orientation | current viewport width/height | portrait / landscape |
| Font scale | `useWindowDimensions().fontScale` | actual runtime scale |
| Device locale/language/direction | `expo-localization useLocales()` | actual device preference |
| Effective UI locale/language/direction | NXS launch policy + `EXPO_PUBLIC_NXS_LOCALE` test override | English or explicit pseudolocale |
| Safe area | `react-native-safe-area-context` | live insets |
| Keyboard | React Native Keyboard events | visible / hidden |
| Color scheme | `useColorScheme` | light / dark |
| Reduce motion | `AccessibilityInfo` query + change event | enabled / disabled / unknown |
| Screen reader | `AccessibilityInfo` query + change event | enabled / disabled / unknown |
| Contrast | Android high-text-contrast / iOS darker-system-colors query | increased / standard / unknown |
| Reduced transparency | iOS AccessibilityInfo query | enabled / disabled / unknown; Android remains unknown |
| Network | NetInfo | online / offline / degraded / unknown + native connection type |

No unavailable signal is fabricated. `unknown` is a first-class state.

## Navigation contract

| Route | Entry | Exit / continuation | Back | Restore | Deep-link requirement | Top-level |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | App launch, `tengasell://` | Sign in, Account, category selection | Platform exit when root | Selected category and list remain while route stays mounted | Reconstruct anonymous/authenticated shell from session authority | Yes |
| `/auth/login` | Home Sign in, direct route | Successful login replaces with Account; degraded state can retry/clear | Returns prior native stack context when pushed from app | Entered values survive validation/network failure while mounted; password is never persisted | Must render safely without prior route state | Contextual |
| `/account` | Home Account, post-login replace, direct route | Retry profile, sign out | Returns prior native stack context when available | Session restored from SecureStore before protected request | Direct entry restores session or redirects to login | Contextual |

## State contract — MOB-01

| Surface | Initial/loading | Populated | Empty/partial | Offline/degraded | Recoverable error | Unrecoverable/session-invalid | Success |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home browse | Explicit canonical-authority loading | Live category/auction records | Empty auction state with useful recovery action | Canonical authority unavailable; no demo authority | Retry connection / retry list | Configuration error remains explicit | Connected state text |
| Login/session | Secure-session recovery | Anonymous login form / authenticated redirect | n/a | Session recovery retry + local clear | Wrong credentials preserve entered identifier/password | Invalid stored session clears privileged state | Authenticated route transition |
| Account | Authenticated profile loading | Profile + TrailBase identity | Missing profile is explicit partial data | Retry session or sign out locally | Retry authenticated profile request | Redirect to login after invalidation | Authenticated authority status |

## Action contract

`NxsButton` preserves the NXS interaction chain at foundation level:

- discovery: visible semantic label;
- approach: ≥48×48 target;
- contact/acknowledgement: immediate pressed state;
- commitment: destructive actions have a distinct semantic variant;
- system response: async actions expose `busy` and truthful loading;
- duplicate prevention: loading actions are disabled;
- result/recovery: calling surfaces expose success state or actionable error/retry paths.

No decorative animation was added merely to satisfy NXS motion language.

## Programme-wide adaptation matrix

Every future Tengasell native screen must be reviewed against:

```text
compact phone
tall phone / one-handed reach
200% text
keyboard visible
landscape
regular/expanded tablet
light mode
dark mode
expanded pseudolocale
RTL pseudolocale
screen reader
network degradation
slow network / repeated tap
```

MOB-01 establishes the environment architecture. A future representative marketplace screen must prove a genuine topology transformation under enlarged text or expanded width; MOB-01 does not manufacture an unnecessary multi-pane layout.

## Certification boundary

This file is implementer evidence, not NXS certification. Physical-device interaction, max text scaling, VoiceOver/TalkBack, pseudolocale/RTL behavior, contrast, platform-native behavior and performance require independent evidence. Final disposition remains reserved to the NXS Moderator.
