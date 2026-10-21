# Task 11-a — comms-service core (TUCS) — full-stack-developer work record

Previous agents' records live in this `/agent-ctx` directory; the master narrative is in
`/home/z/my-project/worklog.md` (see Task 11-plan for the pinned TUCS v1 contract; this
task implemented it exactly — additive extensions only, pinned fields/shapes unchanged).

## What was built

`mini-services/comms-service/` — standalone Bun + TypeScript service on **:3005**
(SQLite WAL at `db/comms.db`, log `dev-comms.log`), zero external dependencies.

- **All 11 pinned tables** (contract A) created idempotently on boot.
- **Providers** (mock-by-default, env-activated real adapters): email
  (Resend), telegram (Bot API), whatsapp (Cloud API + X-Hub-Signature-256 verify when
  `WHATSAPP_APP_SECRET` set), messenger (Graph API). Mock email → `mock_inbox`
  (full branded HTML), mock chats → `mock_chats` role 'bot'; provider_msg_id `mock-<seq>`
  (count-reseeded so ids stay unique across bun --hot reloads).
- **Queue worker**: immediate dispatch, scheduled_at honored, retry ≤3 exponential
  backoff → `dead`+last_error, suppression checked before every send, marketing cap
  1/user/channel/24h, marketing rows mint unsub_token.
- **Moderation pipeline** (contract D order): length ≤2000 → banned words → PII scrub
  (emails, +263/07/0XX-… phones, steering phrases, non-tengasell URLs) → advance-fee
  fraud → graylist→review → 30 msgs/h/thread/sender rate limit. relay_log ALWAYS written.
- **29 endpoints** (contract B) — all curl-verified (proofs in worklog Stage Summary).
- **Templates**: 15 keys × en/ja × email+short = 60 rows, NXS-branded 600px inline-CSS
  email (teal #19717b / gold #dfae2e from globals.css), 44px CTA, pinned footer,
  marketing {unsubUrl} links, {param} interpolation.
- **Campaign engine + demo seeder**: verified links + opt-in + suppression + frequency
  cap; seed-demo idempotent (chipo = only marketing email opt-in).

## Key facts for follow-up tasks (11-b is already wiring the BFF)

- Restart: kill the bun process — the Next dev-server watchdog
  (`src/lib/server/services-spawn.ts`) re-spawns `bun run dev` in the comms-service dir
  within 60s (agent-shell-spawned processes are reaped by the sandbox; watchdog spawns persist).
- Unsub URL shape: `{APP_URL}/api/comms/unsub?token=…`; backend action is `POST /u/unsub`
  (11-d should render a GET confirm page then POST).
- Suppression is channel+handle scoped and blocks ALL sends on that handle per pinned
  contract E — simba@tengamail.co.zw is intentionally suppressed in the demo DB
  (unsub verification test); chipo remains the happy marketing recipient.
- `GET /admin/mock/chats` chat_id = bare id (prefix stripped), role bot/user.
- relay/out response: `moderation.maskedContent` only present when masking applied;
  additive `relayLogId` returned.
- Templates stored per (key, channel 'email'|'short', locale); `short` serves
  telegram/whatsapp/messenger.
- Health provider labels flip to resend/bot/cloud/graph automatically when env creds appear.
- No TrailBase writes from comms — surfacing inbound relay_log into the app is 11-d's job.

Contract deviations: **none**.
