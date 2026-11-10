# MOB-01 — Native build & device verification record

**Programme:** TENGASELL-MOBILE-01 · **Unit:** MOB-01 (foundation + browse + auth)
**Framework:** MSCS 1.0 / UDPCS 1.0 / VAP 1.0
**Recorded:** 2026-11-10 (UTC+2)
**Candidate under test:** `fix/tengasell-mobile-mob01-r3-sdk58-patch-alignment` @ `3b373ea`
**Status:** implementation evidence only — **READY_FOR_VERIFICATION**, not certification.

---

## 1. Environment

| Item | Value |
| --- | --- |
| JDK | 17.0.11 (Temurin) |
| Android SDK | platforms 34 / 36 / 36.1 · build-tools 34–37 |
| Emulator | `Pixel_8` AVD, headless (`-no-window`), API 36 |
| Node | v24.13.1 · npm ci (783 packages, lockfile) |
| Expo | 58.0.21 · React Native 0.88.1 |
| API base | `EXPO_PUBLIC_TENGASELL_API` → staging gateway (quick tunnel) |
| Staging authority | Trailbase v0.35.1 · 55 auctions · trade engine on :3002 |

The staging URL is an **ephemeral quick tunnel**; it is not a production identifier (REL-010).

## 2. Build

```bash
cd mobile
npm ci
npx expo prebuild --platform android --no-install
EXPO_PUBLIC_TENGASELL_API=<staging> ./android/gradlew assembleRelease --no-daemon
```

| Result | Value |
| --- | --- |
| Outcome | **BUILD SUCCESSFUL** in 30m 09s (first run, cold Gradle + 4 ABIs) |
| Artefact | `android/app/build/outputs/apk/release/app-release.apk` |
| Size | 86 MB (universal: armeabi-v7a, arm64-v8a, x86, x86_64) |
| SHA-256 | `1179e0d1c25c66d6d34cb738faa03bfce15dca54345d512cf12612db082f44d2` |
| applicationId | `com.tengasell.app` |
| versionName / Code | 0.1.0 / 1 |
| Signing | **debug keystore** (RN/Expo default) — REL-002 not satisfied |

## 3. Device verification (V3/V4 evidence)

Installed with `adb install -r`, launched `com.tengasell.app/.MainActivity`.

| Check | Result |
| --- | --- |
| App launches, no crash (`logcat -b crash` empty) | ✅ |
| Foreground activity | `com.tengasell.app/.MainActivity` |
| Canonical authority probe | ✅ “● Live auctions connected” |
| Categories from Trailbase | ✅ Phones & Tablets, Electronics, Computers |
| Live auctions render (title, price, bids, seller, countdown) | ✅ 6 visible on first screen |
| Auction data is **live-only** (status filter honoured) | ✅ all rendered rows `status='live'` |
| Auth screen | ✅ username + password fields, show/hide |
| Login end-to-end | ✅ `POST /api/auth/v1/login → 200`, profile fetch `→ 200` |
| Signed-in state | ✅ “✓ Signed in securely — Nyasha Katuruza · @nyasha” |
| Sign-out control present | ✅ |

**Gateway request trace (proves the canonical path, no Prisma/BFF):**

```
[gateway] POST :3001 /api/auth/v1/login -> 200
[gateway] GET  :3001 /api/records/v1/profiles?filter[user][$eq]=… -> 200
[gateway] GET  :3001 /api/records/v1/auctions?filter[status][$eq]=live… -> 200
```

Evidence files: `mobile/build-evidence/home-live.png`, `account-signed-in.png`, `apk.sha256`.

## 4. Staging data condition (disclosed)

The recovered dataset had **0 live auctions** when this build was tested — 51 `sold`, 3 `ended`,
1 `draft`, all `ends_at` in the past (the trade engine had swept them). To exercise the browse
surface, 24 auctions were revived on staging:

```sql
UPDATE auctions SET status='live',
  started_at=strftime(…,'now','-1 day'),
  ends_at   =strftime(…,'now','+'||(2+(id%46))||' hours')
WHERE id IN (… 24 sold/ended rows …);
```

This is a **staging data refresh only** — no code, schema or migration change. A backup of the
prior database was written to `/tmp/main.db.bak-*` before the update.

## 5. Known limitations / open items

| Item | Note |
| --- | --- |
| Auction detail screen | **Not implemented** — tapping a card does nothing. It is MOB-02 scope, not MOB-01. |
| Bidding, offers, live rooms | MOB-03 scope; not present. |
| Signing | Debug keystore; REL-002 requires a real keystore + custody decision. |
| Store artefacts | No AAB, no Play upload; REL-004 pending. |
| Push notifications | Not wired (MSG-003); no FCM/APNs keys. |
| Crash monitoring | Not wired (REL-012); no Sentry DSN. |
| Physical-device gates | Emulator only. SecureStore fault/restart, VoiceOver/TalkBack, 200% scaling, pseudolocales still owed (V7). |
| MFA | Login returns 403 `mfa_token` path is mapped but not exercised (IAM-004). |
| Staging URL | Quick tunnel — hostname changes on restart; not a certification identifier. |

## 6. Custody note

This record was produced against the exact head `3b373ea`. **No commit was added to the candidate
branch**, so its SHA and the R3/DEP01 evidence remain intact. Build artefacts and screenshots live
on the evidence branch / local `mobile/build-evidence/`.

## 7. Declaration

> **STATUS: READY_FOR_VERIFICATION** — I do not self-certify this work. The statements above are
> implementation claims and evidence references for independent verification. Known failures and
> limitations have been disclosed to the best of my available evidence.
