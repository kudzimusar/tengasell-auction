# Task 11-b-2 — health gate + BFF + Comms Center UI (recovery of crashed Task 11-b) — full-stack-developer work record

Previous agents' records live in this `/agent-ctx` directory; the master narrative is in
`/home/z/my-project/worklog.md` (see Task 11-plan for the pinned TUCS v1 contract; the
worklog "Task ID: 11-b" entry is the completed record for this task — written by 11-b-2
after the predecessor crashed before verification).

## Audit verdict (predecessor state → near-complete)

Everything listed by the orchestrator existed and was contract-conformant; no rebuilds needed:

- **BFF** `src/app/api/comms/**` (links GET/POST, links/[id]/verify, links/[id]/disable,
  notifications, preferences) → all proxy through `src/lib/server/comms.ts`:
  TrailBase token → `resolveUserFromToken` → **401 unsigned**; `ensureCommsService`
  lazy-spawn + /health gate → 503; pinned `x-tgs-user` header forwarded; 10s timeout; 502 on proxy failure.
- **UI** `src/components/tengasell/pages/account/comms-center.tsx` (1,226 lines): channel
  cards with status chips; 2-step link wizard (all 4 channels; sandbox code from
  `POST /links` response shown as "Sandbox preview"; Telegram deep-link block; WhatsApp
  +263 normalizer; resume-from-pending); preference matrix grouped per contract §C with
  sticky first column, Switch components, separate gold marketing card + explicit opt-in
  notice, PUT {matrix, marketingOptIn}; notifications list (max-h-96 + ts-scrollbar,
  skeletons, empty state, channel icons, relative time, status badges).
- **Nav** my-page.tsx: "communications" in MY_SECTIONS + sidebar/mobile-tab nav + `{active === "communications" && <CommsSection user={user} />}`.
- **Watchdog** services-spawn.ts comms spec (:3005, `bun run dev`, dev-comms.log) — present and working.
- **i18n** all comms keys exist in BOTH en + ja; ja rendering verified live in the browser.

## Fixes made by 11-b-2

1. **comms-service `routes/me.ts`** — `POST /me/links` 409'd on ANY existing row for the
   same channel+handle → unlink→re-link golden path dead-ended. New semantics:
   `disabled` → revived as pending (fresh code); `pending` → re-send (fresh code on the
   same row, so backing out of step 2 is always recoverable); `verified` → still 409.
   Response shape unchanged. Curl-proven for all 3 branches.
2. **comms-center.tsx** — wizard close now calls `links.reload()` so a sent-but-unverified
   code surfaces as a Pending card with "Enter code" (before: card stayed "Not linked",
   every retry 409'd — unrecoverable).
3. **src/lib/tengasell/hooks.ts** — pre-existing home hydration bug (surfaces as console
   error on warm reloads because `useCategories` initialized from a warm module cache
   and beat lazy-chunk hydration): now always starts loading+skeleton; data arrives via
   promise `.then` in the effect (sync setState version is rejected by the
   `react-hooks/set-state-in-effect` lint rule).

## E2E transcript (agent-browser; ALL PASS)

Route via the **Caddy :81 gateway** — `http://localhost:3000` directly = demo mode and the
BFF 401s. a) home 0 console errors (after Fix 3, cold + reload); b) rufaro sign-in →
Communications → unlink email → re-link → sandbox code 835061 → Verify → toast + Verified;
c) Telegram tg:263771234567 → deep-link + sandbox 315743 → Verified (first attempt hit the
Fix-1 dead-end, fixed + re-run); d) prefs OFF cycle + ON cycle both persisted across reloads
(auction.won→Telegram ON, marketing email ON, all 3 marketing keys fan ON); e) curl
`POST :3005/events` auction.won/Kodak/250 → queued 2 channels → notifications 10→12;
f) 390px: zero horizontal overflow, 44px targets, tab bar stuck, footer natural push;
sticky-footer verified at 1440×1400; desktop clean; ja locale verified; BFF 401s unsigned;
g) `bun run lint` 0 findings; VLM screenshots confirm teal/gold NXS palette + gold marketing
card. 0 console errors across the ENTIRE session.

## Ops note (dev server restart)

The platform-managed Next dev server died mid-E2E (no log trace, no code trigger; platform
did not restart it). Durably restarted via one-shot orphaned `Bun.spawn`
(`bash -c "exec bunx next dev -p 3000 >> dev.log 2>&1"`, parent=init) — plain
`setsid nohup … &` from an agent shell is reaped between tool calls. Instrumentation
watchdog re-ensured TrailBase/trade-engine/GIS/comms on boot; :81 recovered to 200.

## DB state left behind

rufaro: email + telegram verified (re-linked via UI), auction.won→Telegram ON, marketing
email opt-in ON (fan-out sets all 3 marketing keys), 12 notification rows. chipo: scratch
whatsapp row id 13 (+263772000111) disabled — hidden from cards. simba: email still
suppressed (11-a unsub test, by design).

## Leftovers for Task 11-d

- Inbound relay_log surfacing in message thread views (BFF join).
- `GET /api/comms/unsub?token=` branded confirm page (service `POST /u/unsub` done).
- Social share buttons (WhatsApp/Telegram/FB/X) on auctions; i18n completion pass.
- Optional: expose `verify_token` in POST /me/links so the TG deep-link carries
  `?start=<token>` (mints it, never returns it); notifications "mark read" (not in v1).
