# MOB-03 + store path — signing (REL-002) and AAB (REL-004)

**Programme:** TENGASELL-MOBILE-01
**Units:** MOB-03 (live bidding) · REL-002 (mobile signing) · REL-004 (Play distribution artefact)
**Base candidate:** `1fd73a8` (MOB-02) ← `3b373ea` (R3/DEP01)
**Recorded:** 2026-11-10

---

## 1. MOB-03 — bidding over Socket.IO

The detail screen now places real proxy bids through the canonical trade engine.

| Item | Value |
| --- | --- |
| Transport | `socket.io-client` → `{gateway}/?XTransformPort=3002` |
| Auth | `socket.auth.token` from the session (`withAuthenticatedToken`) |
| Event | `bid:place` `{ auctionId, maxAmount }` with ack |
| Ack fields used | `ok`, `amount`, `error`, `outbid`, `winning` |
| Live updates | `auction:update` → detail refetches the record |
| Prohibited | any direct record write to `bids` / `auctions` (IMP-01 authority) |

Device evidence (Pixel_8, signed release build, signed in as `@nyasha`, auction 1015):

```
Live engine connected · US$ 695 · Place bid
→ "You're the leading bidder at US$695."      (first build)
DB after: auctions.current_price = 695.0, bid_count 15
bids row: 444 | auction 1015 | bidder tendai | 695.0
```

The bid was **covered by a standing auto-bid** (`tendai`), so the correct outcome is
`outbid: true`. The first build claimed the lead incorrectly; the client now surfaces
`outbid` and says *“You were outbid — the standing bid is US$X.”* This is the truthful-state
requirement of the NXS layer, and it is why the ack flag is carried through.

## 2. REL-002 — signing custody

| Field | Value |
| --- | --- |
| Keystore | `~/.tengasell/android/tengasell-release.keystore` (PKCS12, mode 600) |
| Alias | `tengasell` |
| Algorithm | RSA 4096, SHA384withRSA, validity 10,000 days |
| Subject | `CN=TengaSell, OU=Mobile, O=TengaSell, L=Harare, ST=Harare, C=ZW` |
| Valid until | 2054-03-28 |
| **SHA-256 fingerprint** | `A7:AA:00:65:24:39:80:77:20:46:E9:BC:E1:12:17:A3:22:6A:59:C4:13:49:F2:C4:A4:DE:8B:0C:6A:5B:6D:71` |
| Password | `TGS_KEYSTORE_PASSWORD` in `~/.tengasell/secrets.env` (never in git) |

Reproducible application (because `expo prebuild` regenerates `android/`):

```bash
bash scripts/apply-release-signing.sh        # rewrites signingConfigs + buildTypes
./gradlew bundleRelease assembleRelease      # with TGS_* env set
```

`scripts/apply-release-signing.sh` replaces the two Gradle blocks by brace matching, so it is
idempotent. Earlier ad-hoc regex editing removed the `release` build type and produced an
**unsigned** APK; the script now owns that edit and the artefacts are verified.

## 3. REL-004 — build artefacts

| Artefact | Path | Size | Signature |
| --- | --- | ---: | --- |
| AAB (Play upload) | `android/app/build/outputs/bundle/release/app-release.aab` | 59 MB | `jarsigner`: **jar verified**, signed by `CN=TengaSell` |
| APK (device install) | `android/app/build/outputs/apk/release/app-release.apk` | 86 MB | `apksigner`: `CN=TengaSell`, digest `a7aa0065…` |

Identity: `com.tengasell.app` · versionName `0.1.0` · versionCode `1` · minSdk/targetSdk from Expo 58.

## 4. What REL-004 still needs (not code)

1. **Play Console upload** of the AAB (Internal testing track) — requires the account session.
2. **Play App Signing** enrolment: this keystore becomes the *upload* key; Google holds the app
   signing key. Keep the upload key backed up; losing it blocks future releases.
3. **versionCode 2** for the next upload (Play rejects duplicates).
4. Store listing, Data safety, content rating — copy is ready in `docs/PLAY_STORE_LISTING.md`.

## 5. Limitations disclosed

- Digital Asset Links (`/.well-known/assetlinks.json`) is **not** required for this native build;
  it existed for the earlier TWA route, which is superseded.
- Bidding verified on an emulator against a staging database; no physical-device run yet.
- The staging URL is a quick tunnel and will change; only the build's baked base URL is affected.
- `MFA` (IAM-004) path is mapped but unexercised; an MFA account would return 403 and the app
  surfaces the "MFA required" message.
- No crash reporting (REL-012) and no push (MSG-003) yet.
