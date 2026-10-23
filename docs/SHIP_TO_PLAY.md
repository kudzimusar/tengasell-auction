# Shipping TengaSell to Google Play

Status: **blocked on two things only you can do.** Everything else is prepared.

## Blockers (in order)

| # | Blocker | Who fixes it | Why it stops the release |
| ---: | --- | --- | --- |
| 1 | **Fly.io trial ended** — `trial has ended, please add a credit card` | you | The app is a Trusted Web Activity: it opens the live URL. A dead URL fails review. Nothing can deploy until billing is restored. |
| 2 | **Play Console sign-in + 2FA** | you | I can build the AAB, but uploading a release, completing Data safety and pressing *Send for review* requires your authenticated session. |
| 3 | **$25 developer registration / identity verification** | you | If the account is already verified this is done; otherwise Play blocks the first release. |

## What is already done

- PWA installability: `public/manifest.webmanifest`, 192/512/maskable icons, `themeColor` `#19717B`
- Digital Asset Links placeholder at `public/.well-known/assetlinks.json` (package `com.tengasell.app`)
- Fingerprint helper: `scripts/android-set-fingerprint.sh`
- Store graphics: `assets/play/` (icon 512, maskable, feature graphic 1024×500, 6 screenshots 1080×1920)
- Listing copy, Data safety and content-rating answers: `docs/PLAY_STORE_LISTING.md`
- Play-policy cleanup: the live "Sealed Codeine" listing was unpublished (prescription medicines are
  prohibited). Auction 2007 is now `draft`.

## Step 1 — restore hosting (~2 minutes)

Add a card at <https://fly.io/trial>, then:

```bash
~/.fly/bin/flyctl apps restart tengasell-zw
curl -s -o /dev/null -w '%{http_code}\n' https://tengasell-zw.fly.dev/     # expect 200
```

If you'd rather not use Fly, the same image runs on any host with a persistent volume
(`docs/DEPLOY_FLY.md` → *Going public*). The URL must stay stable — Play reviewers revisit it.

## Step 2 — build the Android package

Requires JDK 17 (present) and the Android SDK (present at `~/Library/Android/sdk`).

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

npm i -g @bubblewrap/cli
bubblewrap init --manifest https://tengasell-zw.fly.dev/manifest.webmanifest
# package id: com.tengasell.app · name: TengaSell · display: standalone
bubblewrap build            # produces app-release-signed.apk + app-release-bundle.aab
```

`bubblewrap init` also creates a keystore. **Back it up** — losing it means you cannot update the
app (unless Play App Signing takes over the key).

Then publish the fingerprint so Android trusts the site:

```bash
bash scripts/android-set-fingerprint.sh --keystore android.keystore --alias tengasell
# commit + deploy, then verify:
curl -s https://tengasell-zw.fly.dev/.well-known/assetlinks.json
```

Without a matching fingerprint the app opens with a browser address bar — Play rejects that.

## Step 3 — test on the emulator (before uploading)

```bash
emulator -avd Pixel_8 &
adb wait-for-device
adb install -r app-release-signed.apk
adb shell monkey -p com.tengasell.app -c android.intent.category.LAUNCHER 1
```

Check: no address bar, correct icon, deep links (`/#/item/1001`) open inside the app, back button
behaves, and the page works at 1080×1920.

## Step 4 — Play Console

Console: <https://play.google.com/console/u/0/developers/8527437585153848574/home>

1. **Create app** → name `TengaSell — Zimbabwe Auctions`, default language English, *App*, *Free*.
2. **Internal testing** → upload `app-release-bundle.aab`, add your own email as tester, roll out.
3. **Store listing** → paste from `docs/PLAY_STORE_LISTING.md`, upload graphics from `assets/play/`.
4. **Data safety** → copy the answers table (declare payment + messaging + AI sharing).
5. **Content rating** → complete the IARC questionnaire (answers drafted in the same doc).
6. **Privacy policy** → the public URL.
7. **App access** → note that browsing is open; staff tools need credentials (provide test account).
8. Promote internal → closed → production once the internal build passes.

## Step 5 — what I still need from you

- Confirmation the Fly card is added (or the host you choose).
- Either `fly auth login` still valid (it is) **or** the new host's details.
- For the AAB: nothing — signing can be generated locally.
- For the upload: your Play session, or you run the four console steps above while I stand by.

## Honest risks for review

| Risk | Mitigation |
| --- | --- |
| Reviewers see a marketplace with demo listings and a demo login | Add a note in *App access* with a working test account; keep the demo data honest |
| Prescription/controlled goods | The codeine listing is unpublished; marketplace rules prohibit them |
| Privacy URL on a hash route | Add `/privacy` as a real path before submitting (recommended) |
| URL downtime during review | Turn off Fly auto-suspend, or move to a host that never sleeps |
