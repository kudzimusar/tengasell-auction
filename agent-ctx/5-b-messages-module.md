# Task ID: 5-b — Messaging center (realtime chat)

**Agent:** messages-module agent (Z.ai Code)
**Task:** Build `src/components/tengasell/pages/messages/messages-page.tsx` (default export, props `{ threadId?: number }`) — member-to-member messaging tied to listings, realtime via bus `message:new`. Routes: `#/messages`, `#/messages/{id}`, `#/messages?to={username}`.

## Files (all inside `src/components/tengasell/pages/messages/` only)

| File | Purpose |
|---|---|
| `messages-page.tsx` | Default export `{ threadId?: number }` — two-pane desktop (`md:grid-cols-[340px_1fr]`, list 340px \| conversation), mobile single-pane with back; `?to=` query handled on bare route; threads via `useResource(api.threads, [user?.username], { events: ["message:new"] })`; seen-threads ledger (`localStorage ts_seen_threads`, Map<threadId, epochMs>); signed-out gate → #/signin; skeletons / not-found / error+retry for both panes |
| `thread-list.tsx` | Inbox: "Messages" header + count + Live/Offline connection dot (engineConnected); rows: Avatar, username, gold unread dot, formatRelative, subject (auction title \| "Direct message"), 1-line preview (module cache, live via bus), auction thumbnail + compact price; max-h-96 ts-scrollbar; skeleton/empty ("No conversations yet" → Browse auctions)/error-retry |
| `conversation.tsx` | Header: mobile back (router.back()), party → `#/u/{name}` + Buyer/Seller chip, subject, "View item →" → `#/item/{auction_id}`; Radix ScrollArea log with day dividers (Today/Yesterday/date), teal own bubbles end-aligned / muted other bubbles start-aligned, name + relative time under, framer-motion entrance; auto-scroll pinned to bottom (reduced-motion aware) + "New message ↓" chip; sends append-after-resolve, dedupe vs event-refreshed fetch by id |
| `composer.tsx` | Auto-grow textarea (cap ~4 rows / 110px), Enter=send / Shift+Enter=newline (IME-safe), gold 44px Send (spinner while busy), draft preserved on failure |
| `new-message.tsx` | `?to=` pane: recipient card (api.profile), "Direct message" subject, composer → `api.sendMessage({ toUsername, body })` → navigate to resulting thread; recipient-not-found + retry states |
| `helpers.ts` | Module-level auction cache (api.auction once per id, evict on reject), preview cache + bus-event note, seen-threads load/persist, threadUnread, otherParty, dayKey/dayLabel |

## Verification

- `bunx tsc --noEmit` — 0 errors in module.
- `bun run lint` — **0 errors / 0 warnings** project-wide.
- `curl http://localhost:3000/` → **200**.
- Headless Chrome (CDP 9333) end-to-end: signed-out gate; rufaro inbox (2 threads, previews, thumbnails+US$ prices, 2 gold unread dots); `#/messages/2` conversation (Buyer chip, View item, TODAY divider, bubbles, names+times); Enter-send → append + draft cleared + list preview/time updated + `ts_seen_threads` persisted; `#/messages?to=tendai` → send → `#/messages/100` created; simba → empty state; mobile 390px single-pane + back button (panes `display:none` toggling verified); desktop 1280px two-pane; VLM screenshot QA pass (teal/gold palette, no blue/indigo, no layout breakage).
- Pre-existing (not mine): one hydration-mismatch console warning from AppShell MobileTabBar `aria-current`.

## Notes for downstream agents

- In this sandbox the app runs in demo mode (LocalStore) — `message:new` fires locally, fully realtime offline.
- Live mode: `api.sendMessage` is an RPC to the trade engine (port 3002) which **does not exist yet** — sends will toast "Trade engine offline" until that service lands; the inbox header dot will show "Offline".
- Demo inbox: sign in as **rufaro** (seller, 2 seeded threads). `simba` has no seeded threads — shows the empty state.
- Other-party bubbles use `bg-muted` + border rather than literal `bg-raised` (light-mode bg-raised is white-on-white); documented in worklog 5-b.
